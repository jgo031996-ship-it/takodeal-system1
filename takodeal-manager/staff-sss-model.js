// Record keeping only. Frozen employee deductions and SSS remittances are
// separate facts; this module does not calculate contribution rates or dues.
export const SSS_LIMITS=Object.freeze({payrollLinks:2,rows:250,ledgerKeys:500,maxCents:1000000000});
export const sssText=value=>String(value??'').trim();
export const sssKey=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,180}$/.test(value);
export const sssDay=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=2100&&!isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const sssMonth=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value)&&Number(value.slice(0,4))>=2000&&Number(value.slice(0,4))<=2100;
export function sssCents(value){if(!Number.isSafeInteger(value)||value<0||value>SSS_LIMITS.maxCents)throw Error('Contribution amounts must be valid, nonnegative centavo amounts.');return value;}
export function sssPesoCents(value){const text=String(value??'').trim();if(!/^(?:\d+)(?:\.\d{1,2})?$/.test(text))throw Error('Enter a peso amount with up to two decimal places.');return sssCents(Math.round(Number(text)*100));}
export const sssMoney=cents=>'₱'+(sssCents(cents)/100).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const payrollCents=value=>{if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^\d+(?:\.\d{1,2})?$/.test(value.trim())||!Number.isFinite(Number(value))||Number(value)<0)throw Error('The saved SSS deduction needs payroll review.');return sssCents(Math.round(Number(value)*100));};
export const sssReferenceKey=value=>sssText(value).normalize('NFKC').replace(/\s+/g,' ').toUpperCase();
export function savedPayrollSss(record,{staffId,staffName,legacyNameVerified=false}={}){
 const frozen=record?.frozenData;
 if(!record||!sssKey(record.id)||!frozen||typeof frozen!=='object'||Array.isArray(frozen))return {unavailable:true,reason:'No frozen payroll snapshot is saved.',id:record?.id};
 const ids=[record.staffId,frozen.staffId,frozen.profile?.staffId].filter(Boolean);
 if(ids.length?ids.some(id=>id!==staffId):!legacyNameVerified||record.staffName!==staffName||frozen.name&&frozen.name!==staffName)return {unavailable:true,reason:'The saved employee identity needs review.',id:record.id};
 if(!sssDay(record.startDate)||!sssDay(record.endDate)||record.startDate>record.endDate||frozen.start&&frozen.start!==record.startDate||frozen.end&&frozen.end!==record.endDate||frozen.isPaid===false||record.isPaid===false||/^(draft|unpaid|pending|cancelled|canceled|voided|failed)$/i.test(sssText(record.status)))return {unavailable:true,reason:'This is not a confirmed paid cutoff.',id:record.id};
 try{if(record.finalNetPay===undefined||frozen.finalNetPay!==undefined&&payrollCents(record.finalNetPay)!==payrollCents(frozen.finalNetPay))throw Error();payrollCents(record.finalNetPay);}catch{return {unavailable:true,reason:'The saved payroll payment needs review.',id:record.id};}
 if(!Object.hasOwn(frozen,'sss'))return {unavailable:true,reason:'This older payslip did not save an SSS deduction amount.',id:record.id};
 let deductedCents;try{deductedCents=payrollCents(frozen.sss);}catch{return {unavailable:true,reason:'The frozen SSS amount is invalid.',id:record.id};}
 return {payrollRecordId:record.id,startDate:record.startDate,endDate:record.endDate,deductedCents,staffId,staffName:sssText(record.staffName||frozen.name||staffName),legacy:!ids.length};
}
export function sssLedger(data,staffId){
 if(!data)return {version:1,staffId,revision:0,allocatedCentsByPayroll:{}};
 if(data.version===1&&data.staffId===staffId&&data.revision===0&&data.allocatedCentsByPayroll&&typeof data.allocatedCentsByPayroll==='object'&&!Array.isArray(data.allocatedCentsByPayroll)&&Object.keys(data.allocatedCentsByPayroll).length===0&&Object.keys(data).sort().join('|')==='allocatedCentsByPayroll|revision|staffId|version')return {version:1,staffId,revision:0,allocatedCentsByPayroll:{}};
 if(data.version!==1||data.staffId!==staffId||!Number.isSafeInteger(data.revision)||data.revision<1||!data.allocatedCentsByPayroll||typeof data.allocatedCentsByPayroll!=='object'||Array.isArray(data.allocatedCentsByPayroll)||Object.keys(data.allocatedCentsByPayroll).length>SSS_LIMITS.ledgerKeys)throw Error('The saved SSS allocation history needs Owner review.');
 for(const [id,amount]of Object.entries(data.allocatedCentsByPayroll))if(!sssKey(id)||sssCents(amount)!==amount)throw Error('The saved SSS allocation history needs Owner review.');
 return {...data,allocatedCentsByPayroll:{...data.allocatedCentsByPayroll}};
}
export function sssAllocationPlan(selected,savedRows,ledger,staffId){
 if(!Array.isArray(selected)||selected.length>SSS_LIMITS.payrollLinks)throw Error('Link up to two saved payroll cutoffs in one payment record.');
 const rows=new Map(savedRows.map(row=>[row.payrollRecordId,row])),seen=new Set(),allocated={...sssLedger(ledger,staffId).allocatedCentsByPayroll};
 const allocations=selected.map(selection=>{
  const id=selection?.payrollRecordId,row=rows.get(id),amount=sssCents(selection?.amountCents);
  if(!sssKey(id)||seen.has(id)||!row||row.unavailable||amount<=0||sssCents(selection.deductedCents)!==row.deductedCents||selection.startDate!==row.startDate||selection.endDate!==row.endDate)throw Error('A linked saved payroll deduction changed. Refresh the SSS history.');
  const already=allocated[id]||0;if(already>row.deductedCents||already+amount>row.deductedCents)throw Error('This SSS deduction is already recorded as remitted, or its available amount changed. Refresh the history.');
  seen.add(id);allocated[id]=already+amount;return {payrollRecordId:id,startDate:row.startDate,endDate:row.endDate,deductedCents:row.deductedCents,amountCents:amount};
 }).sort((a,b)=>a.payrollRecordId.localeCompare(b.payrollRecordId));
 if(Object.keys(allocated).length>SSS_LIMITS.ledgerKeys)throw Error('This SSS history needs an archival review before another payment can be linked.');
 return {allocations,allocatedCentsByPayroll:allocated,employeeShareCents:sssCents(allocations.reduce((sum,row)=>sum+row.amountCents,0))};
}
export function sssSummary(payroll,ledger,records,staffId){
 const saved=sssLedger(ledger,staffId),valid=payroll.filter(row=>!row.unavailable),known=new Map(valid.map(row=>[row.payrollRecordId,row]));
 let deducted=0,allocated=0;for(const row of valid){const used=saved.allocatedCentsByPayroll[row.payrollRecordId]||0;if(used>row.deductedCents)throw Error('A frozen deduction no longer matches the saved SSS allocation. Owner review is needed.');deducted+=row.deductedCents;allocated+=used;}
 const unresolvedKeys=Object.keys(saved.allocatedCentsByPayroll).filter(id=>!known.has(id));
 const remitted=records.reduce((sum,row)=>sum+sssCents(row.employeeShareCents),0);
 return {deductedCents:deducted,allocatedCents:allocated,unrecordedCents:deducted-allocated,recordedEmployeeShareCents:remitted,recordedEmployerShareCents:records.reduce((sum,row)=>sum+sssCents(row.employerShareCents),0),recordedEcShareCents:records.reduce((sum,row)=>sum+sssCents(row.ecShareCents),0),missingPayrollDetails:payroll.filter(row=>row.unavailable).length,unresolvedKeys};
}
