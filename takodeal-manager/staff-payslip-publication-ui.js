import {readStaffPayslipPublication,publishStaffPayslip,prepareSharedPayslip} from './staff-payslip-publication.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'₱'+value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const fields={loans:'psLoans',advances:'psAdvance',meals:'psFoods',lateDeduction:'psLate',sss:'psSSS',philhealth:'psPhil',pagibig:'psPagibig',straightBonus:'psStraightBonus',perfBonus:'psPerfBonus',holidayPayTotal:'psHoliday',basicPay:'psBasicPay',nightBonus:'psOvertime'};
function number(node,{negative=false}={}){
 if(!node)throw Error('Update the Owner app and reopen the full payslip before sharing it.');
 const raw=String(node.tagName==='INPUT'||node.tagName==='TEXTAREA'?node.value:node.innerText??node.textContent??'').trim().replace(/,/g,'');
 if(!raw||!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))throw Error('Complete every payslip amount before sharing it.');
 const value=Number(raw);if(!Number.isFinite(value)||!negative&&value<0)throw Error('Payslip income and deductions must be valid nonnegative amounts.');return value;
}
export function captureOwnerPayslip(d,data){
 const amounts=Object.fromEntries(Object.entries(fields).map(([key,id])=>[key,number(d.getElementById(id))]));
 const custom=[...d.querySelectorAll('.ps-dynamic-deduction')].map((input,index)=>{
  const label=(data.customDeductions??data.profile?.customDeductions)?.[Number(input.dataset?.deductionIndex??index)]?.name;
  if(typeof label!=='string'||!label.trim())throw Error('Review the custom deduction labels before sharing.');return {name:label.trim(),amount:number(input)};
 });
 return {data:{...data,...amounts,customDeductions:custom,customDeductionsTotal:Math.round(custom.reduce((sum,row)=>sum+row.amount,0)*100)/100,profile:{...data.profile,customDeductions:custom}},finalNetPay:number(d.getElementById('psNetPay'),{negative:true})};
}
export function installOwnerPayslipSharing(w,d,{actorKey,assertFresh,read=readStaffPayslipPublication,publish=publishStaffPayslip}={}){
 if(w.staffPayslipSharing)return w.staffPayslipSharing;
 if(typeof actorKey!=='function'||typeof assertFresh!=='function')throw Error('Payslip sharing needs the existing payroll verification checks.');
 let busy=false,currentView=null;
 const button=()=>d.getElementById('btnShareStaffPayslip');
 const owner=()=>{const user=w.auth?.currentUser;return user?.email?.toLowerCase()==='jgo031996@gmail.com'&&user.emailVerified===true&&user.providerData?.some(row=>row.providerId==='google.com')&&w.sessionUser?.uid===user.uid&&w.sessionUser?.isOwner===true&&!w.sessionUser?.isFranchisee;};
 const eligible=data=>owner()&&data&&!data.isPaid&&!w.paidPayrollSnapshots?.has(data)&&!data.attendanceReviewRequired&&!data.salaryReviewRequired;
 function sync(data,{history=false}={}){currentView={data,history};const node=button();if(node){node.hidden=history||!eligible(data);node.disabled=busy||!!w.payrollPaymentPending;node.textContent='Save & share payslip';}}
 async function share(){
  const data=w.currentPayslipData;if(busy||w.payrollPaymentPending||!eligible(data))return false;
  let key,token,saved=false;const user=w.auth.currentUser,session=w.sessionUser;
  const owns=()=>w.currentPayslipData===data&&w.auth.currentUser===user&&w.sessionUser===session;
  busy=true;if(button()){button().disabled=true;button().textContent='Checking payslip…';}
  try{
   key=actorKey();token=w.requirePayrollPreview(data);
   const current=()=>{w.getPayrollPreviewGuard().assertCurrent(token);w.requirePayrollPreview(data);if(!owns()||!eligible(data)||actorKey()!==key||w.payrollPaymentPending||d.getElementById('payslipModal')?.style.display==='none')throw Error('The selected payslip, account or payment state changed. Reopen Save & share.');};
   current();w.recalcPayslip?.();const captured=captureOwnerPayslip(d,data),prepared=prepareSharedPayslip(captured.data,captured.finalNetPay),intent=JSON.stringify(prepared);
   const unchanged=()=>{current();const next=captureOwnerPayslip(d,data);if(JSON.stringify(prepareSharedPayslip(next.data,next.finalNetPay))!==intent)throw Error('Payslip amounts changed. Review them and choose Save & share again.');};
   await assertFresh(data);unchanged();const prior=await read(w,{data:captured.data,assertCurrent:unchanged});unchanged();
   const choice=await w.Swal.fire({title:prior.revision?'Update the shared payslip?':'Share this payslip with staff?',html:'<p><strong>'+esc(data.name)+'</strong><br>'+esc(data.start)+' → '+esc(data.end)+'</p><p>Gross income: <strong>'+money(prepared.grossPay)+'</strong><br>Deductions: <strong>'+money(prepared.totalDeductions)+'</strong><br>Net pay: <strong>'+money(prepared.finalNetPay)+'</strong></p><p>This saves the reviewed figures for the Staff Vault. Payment is a separate action.</p>',showCancelButton:true,confirmButtonText:prior.revision?'Save updated payslip':'Save & share',focusConfirm:false});
   if(!choice.isConfirmed)return false;unchanged();if(button())button().textContent='Sharing reviewed payslip…';await assertFresh(data);unchanged();
   const result=await publish(w,{...captured,expectedRevision:prior.revision,assertCurrent:unchanged});unchanged();saved=true;
   await w.Swal.fire({title:'Payslip shared',text:'Revision '+result.revision+' is saved. Staff can refresh their unlocked Payslip Vault to see these exact figures.',icon:'success'});return result;
  }catch(error){if(owns())await w.Swal.fire({title:saved?'Payslip saved; reopen to review':'Payslip sharing was not confirmed',text:error.message||'Reconnect and check the saved revision before retrying.',icon:'warning'});return false;}
  finally{busy=false;if(currentView?.data===w.currentPayslipData)sync(currentView.data,{history:currentView.history});}
 }
 const controller={sync,share};w.staffPayslipSharing=controller;w.saveAndShareStaffPayslip=share;return controller;
}
