import {isPayrollAdjustment,validatePayrollAdjustmentRecord,payrollAdjustmentPreview} from './payroll-adjustment-model.js';
// Read-only. Credits use their stable employee ID, never a nickname match.
export async function readStaffPayrollAdjustments(api,{staffId,stillCurrent=()=>true}={}){
 try{
  if(typeof staffId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(staffId)||typeof api.readPrivatePayrollInputs!=='function')throw Error('Reconnect to confirm your private payroll adjustment records.');
  if(!stillCurrent())throw Error('This Pay view changed. Reopen Pay.');
  const input=await api.readPrivatePayrollInputs({staffId,assertCurrent:()=>{if(!stillCurrent())throw Error('This Pay view changed.');}});
  if(!stillCurrent())throw Error('This Pay view changed. Reopen Pay.');
  if(input?.schemaVersion!==1||input.staffId!==staffId||input.complete!==true||!Array.isArray(input.staffBonuses)||input.staffBonuses.length>500)throw Error('Your payroll adjustment history could not be confirmed completely.');
  if(input.staffBonuses.some(row=>!row||row.staffId!==staffId))throw Error('The private payroll adjustment identity could not be confirmed.');
  const rows=input.staffBonuses.filter(isPayrollAdjustment);
  for(const row of rows)validatePayrollAdjustmentRecord(row,{staffId});
  return {held:false,rows,message:''};
 }catch(error){return {held:true,rows:[],message:error.message||'Reconnect to confirm payroll adjustment records.'};}
}
export function staffPayrollAdjustmentEstimate(checked,{staffId,name,branch,start,end}={}){
 if(checked.held)return {held:true,amount:0,rows:[],message:checked.message};
 try{return {held:false,...payrollAdjustmentPreview(checked.rows,{staffId,name,branch,start,end}),message:''};}
 catch(error){return {held:true,amount:0,rows:[],message:error.message||'Ask the Owner to review the saved payroll adjustment.'};}
}
