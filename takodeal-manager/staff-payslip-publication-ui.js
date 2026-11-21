import {readStaffPayslipPublication,publishStaffPayslip,prepareSharedPayslip} from './staff-payslip-publication.js';
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
 let view=null;
 const status=(v,message)=>{if(view===v&&w.currentPayslipData===v.data){const el=d.getElementById('staffPayslipSync');if(el)el.textContent=message;}};
 const permitted=()=>{const user=w.auth?.currentUser;return user?.email?.toLowerCase()==='jgo031996@gmail.com'&&user.emailVerified===true&&w.sessionUser?.isOwner===true&&w.sessionUser.uid===user.uid;};
 function inputs(){return [...Object.entries(fields).map(([key,id])=>[key,d.getElementById(id)]),...Array.from(d.querySelectorAll('.ps-dynamic-deduction'),(node,i)=>['custom-'+i,node])];}
 function sync(data,{history=false}={}){
  view=null;const label=d.getElementById('staffPayslipSync');if(label)label.textContent='';
  if(history||!permitted()||!data||data.isPaid||w.paidPayrollSnapshots?.has(data)||data.attendanceReviewRequired||data.salaryReviewRequired)return;
  const v={data,actor:actorKey(),token:w.requirePayrollPreview(data),revision:0,touched:new Set(),overrides:{},queue:Promise.resolve(),ready:false};
  view=v;status(v,'Checking Staff Vault…');
  const guard=()=>{if(!permitted()||actorKey()!==v.actor||w.paidPayrollSnapshots?.has(data)||data.isPaid)throw Error('The payroll account or payment changed. Reopen the payslip.');w.getPayrollPreviewGuard().assertCurrent(v.token);};
  const capture=()=>{const c=captureOwnerPayslip(d,data);c.data.vaultOverrides={...v.overrides};return c;};
  function enqueue(c){
   v.latest=c;
   const send=async()=>{guard();const prepared=prepareSharedPayslip(c.data,c.finalNetPay),intent=JSON.stringify(prepared.snapshot);
    if(intent===v.last)return;
    status(v,'Syncing to Staff Vault…');await assertFresh(data);guard();
    const result=await publish(w,{...c,expectedRevision:v.revision,assertCurrent:guard});
    v.revision=result.revision;v.last=intent;status(v,'Staff Vault synced · Unpaid');};
   v.queue=v.queue.catch(()=>{}).then(send);v.queue.catch(error=>status(v,'Vault sync pending · '+error.message));return v.queue;
  }
  function changed(node){
   const pair=inputs().find(([,el])=>el===node);if(!pair)return;
   const [key]=pair;v.touched.add(key);
   try{v.overrides[key]=number(node);if(v.ready){w.recalcPayslip();void enqueue(capture());}}catch(error){status(v,error.message);}
  }
  v.changed=changed;
  v.retry=()=>{if(v.ready&&v.latest)return enqueue(v.latest);return begin();};
  function begin(){v.open=Promise.resolve().then(async()=>{
   const previous=await read(w,{data,assertCurrent:guard});guard();if(view!==v)return;
   v.revision=previous.revision;const snap=previous.publication?.snapshot;
   const prior=snap?.vaultOverrides||{};
   for(const [key,node] of inputs()){
    if(!node||node.tagName!=='INPUT'||v.touched.has(key))continue;
    const index=key.startsWith('custom-')?Number(key.slice(7)):null;
    const label=index===null?null:(data.customDeductions??data.profile?.customDeductions)?.[index]?.name;
    const beforeKey=index===null?key:'custom-'+(snap?.customDeductions||[]).findIndex(row=>row.name===label);
    const value=Object.hasOwn(prior,beforeKey)?prior[beforeKey]:undefined;
    if(Number.isFinite(value)&&value>=0){node.value=String(value);v.overrides[key]=value;}
   }
   w.recalcPayslip();v.ready=true;
   if(snap&&!snap.vaultOverrides&&!v.touched.size){
    // A draft from the manual-share release has no per-field edit history.
    // Restore the saved editable amounts only when it refers to the same punches.
    const punches=logs=>(logs||[]).map(x=>[x.attendanceLogId,x.timeInAt,x.timeOutAt]);
    if(JSON.stringify(punches(snap.logs))===JSON.stringify(punches(data.logs))){
     for(const [key,node] of inputs()){
      const val=key.startsWith('custom-')?snap.customDeductions?.[Number(key.slice(7))]?.amount:snap[key];
      if(node?.tagName==='INPUT'&&Number.isFinite(val)&&number(node)!==val){node.value=String(val);v.overrides[key]=val;}
     }
     w.recalcPayslip();
    }
   }
   v.last=snap?JSON.stringify(snap):null;const next=capture();
   if(JSON.stringify(prepareSharedPayslip(next.data,next.finalNetPay).snapshot)===v.last){status(v,'Staff Vault synced · Unpaid');return;}
   await enqueue(next);
  });
  v.open.catch(error=>status(v,'Vault sync pending · '+error.message));return v.open;}
  begin();
 }
 d.addEventListener('change',event=>{if(view&&w.currentPayslipData===view.data)view.changed(event.target);});
 w.addEventListener?.('online',()=>{if(view&&w.currentPayslipData===view.data&&!w.payrollPaymentPending)void view.retry().catch(()=>{});});
 const controller={sync,async beforePayment(data){const v=view;if(v?.data===data){if(!v.ready)await v.open;if(!v.ready)throw Error('Reopen the payslip to load the saved Staff Vault figures.');await v.queue;}}};
 w.staffPayslipSharing=controller;return controller;
}
