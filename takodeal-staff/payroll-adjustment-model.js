// Positive, one-time payroll credits. This module never reads or writes records.
export const PAYROLL_ADJUSTMENT_TYPE='Payroll Adjustment';
export const PAYROLL_ADJUSTMENT_LIMIT=40;
const text=value=>String(value??'').trim();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'₱'+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
export function payrollAdjustmentDay(value){
 if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))throw Error('Choose valid payroll work dates.');
 const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value)throw Error('Choose valid payroll work dates.');return value;
}
export function payrollAdjustmentCents(value,{zero=false}={}){
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^\d+(?:\.\d{1,2})?$/.test(value.trim())||String(value).trim()==='')throw Error('Enter a positive credit using pesos and centavos.');
 const amount=Number(value),cents=Math.round(amount*100);if(!Number.isFinite(amount)||!Number.isSafeInteger(cents)||Math.abs(amount*100-cents)>0.00001||cents<(zero?0:1)||cents>100000000000)throw Error('A payroll credit must be a valid positive amount.');return cents;
}
export function payrollAdjustmentId(value){if(typeof value!=='string'||!/^payroll-adjustment-[a-f0-9]{64}$/.test(value))throw Error('Reopen the saved payroll adjustment.');return value;}
export const isPayrollAdjustment=row=>row?.type===PAYROLL_ADJUSTMENT_TYPE||String(row?.id||'').startsWith('payroll-adjustment-');
const staffKey=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,160}$/.test(value);
const sourceKey=value=>value===''||typeof value==='string'&&/^[-A-Za-z0-9_]{1,180}$/.test(value);
export function payrollAdjustmentInput(input,{today}={}){
 const staffId=input?.staffId,originalStart=payrollAdjustmentDay(input?.originalStart),originalEnd=payrollAdjustmentDay(input?.originalEnd),effectiveDate=payrollAdjustmentDay(input?.effectiveDate),reason=text(input?.reason),sourcePayrollRecordId=text(input?.sourcePayrollRecordId);
 if(!staffKey(staffId)||originalStart>originalEnd||originalEnd>=effectiveDate||+new Date(originalEnd)-+new Date(originalStart)>732*86400000||reason.length<8||reason.length>1500||!sourceKey(sourcePayrollRecordId))throw Error('Confirm the saved employee, past cutoff, effective work date and reason for this credit.');
 if(today&&(effectiveDate<today||originalEnd>=today))throw Error('The original cutoff must be in the past; the credit starts today or a future work date.');
 return {staffId,originalStart,originalEnd,effectiveDate,reason,sourcePayrollRecordId,amount:payrollAdjustmentCents(input.amount)/100};
}
export function payrollAdjustmentDetail(row){
 const originalStart=payrollAdjustmentDay(row?.originalStart),originalEnd=payrollAdjustmentDay(row?.originalEnd),effectiveDate=payrollAdjustmentDay(row?.effectiveDate),reason=text(row?.reason),sourcePayrollRecordId=text(row?.sourcePayrollRecordId);
 if(originalStart>originalEnd||originalEnd>=effectiveDate||reason.length<8||reason.length>1500||!sourceKey(sourcePayrollRecordId))throw Error('A previous payroll credit has incomplete saved details. Ask the Owner to review it.');
 return {id:payrollAdjustmentId(row.id),amount:payrollAdjustmentCents(row.amount)/100,originalStart,originalEnd,effectiveDate,reason,sourcePayrollRecordId};
}
export function validatePayrollAdjustmentRecord(row,{staffId,name,branch,unpaid=false}={}){
 if(!row||row.type!==PAYROLL_ADJUSTMENT_TYPE||row.payrollAdjustmentVersion!==1||!staffKey(row.staffId)||!text(row.staffName)||!text(row.branch)||!['Unpaid','Paid','Cancelled'].includes(row.status)||!text(row.createdByUid)||!text(row.createdByEmail))throw Error('A payroll adjustment record needs Owner review.');
 if(staffId&&row.staffId!==staffId||name&&row.staffName!==name||branch&&row.branch!==branch)throw Error('A payroll credit belongs to another saved employee or branch.');
 if(unpaid&&(row.status!=='Unpaid'||['paidAt','payrollRecordId','amountPaid','partialPaid','payrollFrozen'].some(key=>Object.hasOwn(row,key))))throw Error('A payroll credit changed or was already included in a payslip. Regenerate payroll.');
 return payrollAdjustmentDetail(row);
}
export function payrollAdjustmentCandidates(rows,{start,end}={}){
 end=payrollAdjustmentDay(end);if(start)payrollAdjustmentDay(start);
 return rows.filter(row=>isPayrollAdjustment(row)&&row.status==='Unpaid').filter(row=>{
  const detail=validatePayrollAdjustmentRecord(row,{unpaid:true});
  if(detail.effectiveDate>end)return false;
  if(start&&detail.originalEnd>=start)throw Error('The old cutoff of a payroll credit overlaps this payslip. Choose the next eligible unpaid cutoff.');
  return true;
 }).sort((a,b)=>a.effectiveDate.localeCompare(b.effectiveDate)||a.id.localeCompare(b.id));
}
export function payrollAdjustmentPreview(rows,{staffId,name,branch,start,end}={}){
 const due=payrollAdjustmentCandidates(rows,{start,end});if(due.length>PAYROLL_ADJUSTMENT_LIMIT)throw Error('This employee has too many pending payroll adjustments for one safe payment.');
 const details=due.map(row=>validatePayrollAdjustmentRecord(row,{staffId,name,branch,unpaid:true}));
 return {amount:details.reduce((sum,row)=>sum+payrollAdjustmentCents(row.amount),0)/100,rows:details};
}
export function validatePayrollAdjustmentSet(data,candidates,get){
 const expected=data.payrollAdjustmentRows??[];
 if(!Array.isArray(expected)||expected.length>PAYROLL_ADJUSTMENT_LIMIT)throw Error('Review the saved payroll credit details before paying.');
 const total=payrollAdjustmentCents(data.payrollAdjustments??0,{zero:true}),wanted=new Map();
 for(const row of expected){const detail=payrollAdjustmentDetail(row);if(wanted.has(detail.id))throw Error('A payroll adjustment appears more than once.');wanted.set(detail.id,detail);}
 if([...wanted.values()].reduce((sum,row)=>sum+payrollAdjustmentCents(row.amount),0)!==total)throw Error('Payroll credit details do not match the payslip total.');
 const due=payrollAdjustmentCandidates(candidates,{start:data.start,end:data.end});
 if(due.length!==wanted.size)throw Error('Pending payroll credits changed. Regenerate this unpaid payslip.');
 const details=due.map(row=>{
  const fresh=get(row.id);if(!fresh)throw Error('A payroll credit is missing. Regenerate payroll.');
  const detail=validatePayrollAdjustmentRecord({...fresh,id:row.id},{staffId:data.staffId,name:data.name,branch:data.branch,unpaid:true});
  if(JSON.stringify(detail)!==JSON.stringify(wanted.get(row.id)))throw Error('A payroll credit amount or original cutoff changed. Regenerate payroll.');
  return detail;
 });
 return details;
}
export function savedPayrollAdjustmentDetails(data={}){
 const saved=data.frozenData&&typeof data.frozenData==='object'?data.frozenData:data,amount=payrollAdjustmentCents(saved.payrollAdjustments??0,{zero:true}),rows=saved.payrollAdjustmentRows??[];
 if(!Array.isArray(rows)||rows.length>PAYROLL_ADJUSTMENT_LIMIT)throw Error('The saved payroll credit details need Owner review.');
 const seen=new Set(),details=rows.map(row=>{const detail=payrollAdjustmentDetail(row);if(seen.has(detail.id))throw Error('The saved payroll credit appears more than once.');seen.add(detail.id);return detail;});
 if(details.reduce((sum,row)=>sum+payrollAdjustmentCents(row.amount),0)!==amount)throw Error('The saved payroll credit total and itemized details do not match.');
 return {amount:amount/100,rows:details};
}
export function payrollAdjustmentDetailsHTML(data,{live=false}={}){
 let result;try{result=savedPayrollAdjustmentDetails(data);}catch{return '<p style="font-size:12px;color:#92400e">Payroll adjustment details could not be confirmed. Ask the Owner to review the original record.</p>';}
 if(!result.amount)return '';
 return '<section class="payroll-adjustment-details" style="margin:14px 0;padding:12px;border:1px solid #b9d9c3;border-radius:10px;background:#f3fbf5;text-align:left;break-inside:avoid"><h4 style="margin:0 0 8px;font-size:14px;color:#166534">Previous payroll credits · '+money(result.amount)+'</h4><p style="font-size:11px;line-height:1.5;color:#64748b;margin:0 0 8px">'+(live?'Pending one-time credits for the next eligible unpaid payslip. Saved paid payroll stays unchanged.':'These credits were included once in this saved payslip. The original paid cutoff was kept unchanged.')+'</p>'+result.rows.map(row=>'<article style="padding:8px 0;border-top:1px solid #d3e6d9"><strong>'+escape(row.originalStart)+' to '+escape(row.originalEnd)+' · '+money(row.amount)+'</strong><p style="margin:4px 0;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere">'+escape(row.reason)+'</p><small>Effective '+escape(row.effectiveDate)+(row.sourcePayrollRecordId?' · Original payslip '+escape(row.sourcePayrollRecordId):' · Previously unpaid cutoff')+'</small></article>').join('')+'</section>';
}
export function payrollAdjustmentHistoryHTML(rows){
 const credits=rows.filter(isPayrollAdjustment).sort((a,b)=>String(b.effectiveDate).localeCompare(String(a.effectiveDate))||String(a.id).localeCompare(String(b.id)));
 return credits.length?'<section style="margin:16px 0;padding:14px;background:#f4faf5;border:1px solid #c6decc;border-radius:12px;text-align:left"><h3 style="margin:0 0 10px;font-size:15px;color:#166534">Previous payroll adjustments</h3>'+credits.map(row=>{try{const detail=validatePayrollAdjustmentRecord(row),status=row.status==='Paid'?'Included in paid payslip':row.status==='Cancelled'?'Cancelled before payment':'Pending next eligible payroll';return '<article style="padding:10px 0;border-top:1px solid #d4e6d9"><strong>'+escape(detail.originalStart)+' to '+escape(detail.originalEnd)+' · '+money(detail.amount)+'</strong><p style="margin:4px 0;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere">'+escape(detail.reason)+'</p><small>'+status+' · Effective '+escape(detail.effectiveDate)+(row.payrollRecordId?' · Payslip '+escape(row.payrollRecordId):'')+'</small>'+((row.cancel??row.cancelReason)?'<p style="font-size:11px">Cancellation: '+escape(row.cancel??row.cancelReason)+'</p>':'')+'</article>';}catch{return '<p style="font-size:12px;color:#92400e">A saved adjustment needs Owner review before it can be included.</p>';}}).join('')+'</section>':'';
}
