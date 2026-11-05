import {payrollActorKey} from './payroll-completion.js';
const originalValues=new WeakMap();
export function rememberPayslipInputs(data,document){
 if(data&&!data.isPaid)originalValues.set(data,new Map([...document.querySelectorAll('#printablePayslip input')].filter(row=>row.id).map(row=>[row.id,row.value])));
}
export function installPayrollAdjustmentRefresh(w,d){
 if(w.payrollAdjustmentRefresh)return w.payrollAdjustmentRefresh;
 let refreshing=null,queued=null;
 async function refresh({staffId}={}){
  if(refreshing){queued={staffId};return refreshing;}
  const run=async()=>{
   const identity=payrollActorKey(w),from=d.getElementById('payrollStart')?.value,to=d.getElementById('payrollEnd')?.value,old=w.currentPayslipData;
   const visible=d.getElementById('payslipModal')?.style.display!=='none',reopen=visible&&old&&!old.isPaid&&!w.paidPayrollSnapshots?.has(old)&&(!staffId||old.staffId===staffId);
   const baseline=old&&originalValues.get(old);
   const current=()=>{if(payrollActorKey(w)!==identity||d.getElementById('payrollStart')?.value!==from||d.getElementById('payrollEnd')?.value!==to)throw Error('Payroll selection changed. Generate the selected cutoff to see the saved adjustment.');};
   w.invalidateCollectionCache?.('staff_bonuses');w.invalidateCollectionCache?.('staff_deductions');w.invalidateCache?.('staff_bonuses');w.invalidateCache?.('staff_deductions');
   w.getPayrollPreviewGuard?.().invalidate?.('Payroll adjustment saved. Refreshing the unpaid cutoff.');
   if(staffId&&d.getElementById('empProfileId')?.value===staffId)await w.refreshEmployeeOneTimeDeductionRows?.(staffId);
   current();
   if(!/^\d{4}-\d\d-\d\d$/.test(from||'')||!/^\d{4}-\d\d-\d\d$/.test(to||'')||from>to)return {refreshed:false};
   await w.generateAutoPayslips?.();current();
   if(reopen&&!old.isPaid&&!w.paidPayrollSnapshots?.has(old)&&w.currentPayslipData===old&&d.getElementById('payslipModal')?.style.display!=='none'){
    const edits=baseline?[...d.querySelectorAll('#printablePayslip input')].filter(row=>row.id&&baseline.has(row.id)&&row.value!==baseline.get(row.id)&&!row.disabled).map(row=>({id:row.id,value:row.value})):[];
    const fresh=Object.values(w.globalPayrollCache||{}).find(row=>row.staffId===old.staffId&&row.start===from&&row.end===to);if(fresh&&!fresh.isPaid){await w.openPayslipModal(fresh.name);current();if(w.currentPayslipData!==fresh)return {refreshed:true,reopened:false};for(const edit of edits){const field=d.getElementById(edit.id);if(field&&!field.disabled)field.value=edit.value;}w.recalcPayslip?.();}
   }
   return {refreshed:true};
  };
  refreshing=run();try{return await refreshing;}finally{refreshing=null;if(queued){const next=queued;queued=null;void refresh(next).catch(error=>w.ManagerUI?.notify?.(error.message));}}
 }
 w.addEventListener('payroll-adjustments-changed',event=>void refresh(event.detail).catch(error=>w.ManagerUI?.notify?.('The adjustment was saved. '+error.message)));
 const controller={refresh};w.payrollAdjustmentRefresh=controller;return controller;
}
