import {isPayrollAdjustment,validatePayrollAdjustmentRecord,payrollAdjustmentPreview} from './payroll-adjustment-model.js';
// Read-only. Credits use their stable employee ID, never a nickname match.
export async function readStaffPayrollAdjustments(api,{staffId,stillCurrent=()=>true}={}){
 try{
  if(typeof staffId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(staffId)||typeof api.getDocsFromServer!=='function')throw Error('Reconnect to confirm your payroll adjustment records.');
  if(!stillCurrent())throw Error('This Pay view changed. Reopen Pay.');
  const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'staff_bonuses'),api.where('staffId','==',staffId)));
  if(!stillCurrent())throw Error('This Pay view changed. Reopen Pay.');
  if(!snap||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||!Array.isArray(snap.docs)||snap.docs.length>250)throw Error('Your payroll adjustment history could not be confirmed completely.');
  const rows=snap.docs.map(document=>{if(document.metadata?.fromCache||document.metadata?.hasPendingWrites)throw Error('A payroll adjustment is still awaiting confirmation.');return {...document.data(),id:document.id};}).filter(isPayrollAdjustment);
  for(const row of rows)validatePayrollAdjustmentRecord(row,{staffId});
  return {held:false,rows,message:''};
 }catch(error){return {held:true,rows:[],message:error.message||'Reconnect to confirm payroll adjustment records.'};}
}
export function staffPayrollAdjustmentEstimate(checked,{staffId,name,branch,start,end}={}){
 if(checked.held)return {held:true,amount:0,rows:[],message:checked.message};
 try{return {held:false,...payrollAdjustmentPreview(checked.rows,{staffId,name,branch,start,end}),message:''};}
 catch(error){return {held:true,amount:0,rows:[],message:error.message||'Ask the Owner to review the saved payroll adjustment.'};}
}
