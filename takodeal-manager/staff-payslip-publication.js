import {OWNER_EMAIL} from './workspace-access-model.js';
import {dailyStaffRate,validRateDate} from './staff-rate-model.js';
import {payslipSavedAmounts,savedPayslipCents} from './staff-payslip-snapshot.js';
import {savedPayrollAdjustmentDetails} from './payroll-adjustment-model.js';
import {payrollRecoveryDetails} from './payroll-recovery-model.js';
const pending=new WeakMap(),clone=value=>JSON.parse(JSON.stringify(value)),text=value=>typeof value==='string'?value.trim():'';
const readDeadline=promise=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The saved payslip check took too long. Reconnect and reopen Save & share.')),25000);})]).finally(()=>clearTimeout(timer));};
const id=value=>{if(typeof value!=='string'||!/^[-\w]{1,180}$/.test(value))throw Error('Reopen the saved employee before sharing a payslip.');return value;};
export function staffPayslipPreviewId(staffId,start,end){id(staffId);if(!validRateDate(start)||!validRateDate(end)||start>end)throw Error('Choose the exact payslip cutoff.');return staffId+'-'+start+'-'+end;}
const fields=['basicPay','nightBonus','straightBonus','holidayPayTotal','perfBonus','payrollAdjustments','lateDeduction','sss','philhealth','pagibig','advances','meals','loans','onlineRefunds','cashShortages','ownerDeductions'];
const safeRow=(row,keys)=>Object.fromEntries(keys.filter(key=>row?.[key]!==undefined).map(key=>[key,clone(row[key])]));
const detailFields=['id','bucket','type','amount','label','category','incidentDate','effectiveDate','dateAdded','sourcePlatform','sourceReceiptId','sourceSaleId','purchaseId','purchaseReceiptId','receiptId','item','remarks','originalAmount','purchaseAmount','discountPct'];
const itemFields=['name','itemName','label','qty','quantity','size','variant','variantName','notes','unitAmount','lineAmount','baseAmount','discountAmount','amount','lineTotalFinal','sourceLineIndex'];
function safeDetails(rows){return (Array.isArray(rows)?rows:[]).map(row=>{
  const result=safeRow(row,detailFields),source=row?.items||row?.purchasedItems||row?.selectedItems||row?.cart;
  if(row?.payrollRecovery)result.payrollRecovery=payrollRecoveryDetails(row.payrollRecovery);
  if(Array.isArray(source))result.items=source.map(item=>{
    const saved=safeRow(item,itemFields),options=Array.isArray(item?.addons)?item.addons.map(addon=>['',addon]):item?.addons&&typeof item.addons==='object'?Object.entries(item.addons):[];
    if(options.length)saved.addons=options.filter(([,value])=>value!=null&&value!==false&&value!==0).map(([key,value])=>text(typeof value==='string'?value:value?.name||value?.itemName||key)).filter(Boolean);return saved;
  });return result;
});}
export function prepareSharedPayslip(data,finalNetPay){
  if(!data||data.isPaid||data.attendanceReviewRequired||data.salaryReviewRequired)throw Error('This payslip is paid or held for attendance or salary review. Resolve the review before sharing it.');
  const staffId=id(data.staffId),start=data.start,end=data.end;staffPayslipPreviewId(staffId,start,end);
  if(!text(data.name)||!text(data.branch))throw Error('Confirm the saved employee and branch before sharing.');
  if([data.profile?.staffId,data.profile?.id].some(value=>value&&value!==staffId))throw Error('The payslip profile belongs to another employee.');
  const amounts=payslipSavedAmounts(data),net=savedPayslipCents(finalNetPay,{negative:true}),gross=savedPayslipCents(amounts.grossPay),deducted=savedPayslipCents(amounts.totalDeductions);
  if(gross-deducted!==net)throw Error('The edited payslip total changed. Recalculate and review it before sharing.');
  const custom=data.customDeductions??data.profile?.customDeductions??[];
  if(!Array.isArray(custom)||custom.length>100||custom.some(row=>!row||!text(row.name)||text(row.name).length>200))throw Error('Each custom deduction needs its saved label.');
  const customDeductions=custom.map(row=>({name:text(row.name),amount:savedPayslipCents(row.amount,{missing:true})/100}));
  const customTotal=customDeductions.reduce((sum,row)=>sum+savedPayslipCents(row.amount),0);
  if(data.customDeductionsTotal!=null&&savedPayslipCents(data.customDeductionsTotal)!==customTotal)throw Error('Custom deduction labels do not match the edited total.');
  const profile=safeRow(data.profile,['cashierName','role','dateHired','hourlyRate','salaryRateVersion','salaryRateRevision','eligibleNightDiff','nightDiffRate']);
  profile.staffId=staffId;profile.customDeductions=customDeductions;
  const snapshot={staffId,name:text(data.name),branch:text(data.branch),start,end,isPaid:false,...Object.fromEntries(fields.map(key=>[key,amounts[key]])),
    customDeductions,customDeductionsTotal:customTotal/100,grossPay:gross/100,totalDeductions:deducted/100,finalNetPay:net/100,profile,
    logs:(Array.isArray(data.logs)?data.logs:[]).map(row=>safeRow(row,['date','dateString','in','out','hrs','remark','branch','attendanceLogId','timeInAt','timeOutAt','expectedStartAt','expectedEndAt','scheduleSource','scheduleRevisionId','lateMins','rateWorkDate','dailyRate','nightBonus','bonusBasis','bonusReviewReason'])),
    ...safeRow(data,['hours','shiftsWorked','penalties'])};
  for(const name of ['deductionDetails','onlineRefundRows','cashShortageRows','ownerDeductionDetails'])if(Array.isArray(data[name]))snapshot[name]=safeDetails(data[name]);
  if(data.deductionDetailsVersion===1)snapshot.deductionDetailsVersion=1;
  snapshot.payrollAdjustmentRows=savedPayrollAdjustmentDetails(data).rows;
  if(Array.isArray(data.payrollRecoveryRows))snapshot.payrollRecoveryRows=data.payrollRecoveryRows.map(row=>({...safeRow(row,['id','amount']),...payrollRecoveryDetails(row)}));
  if(new TextEncoder().encode(JSON.stringify(snapshot)).length>750000)throw Error('This payslip is too large to share safely. Ask HQ to review its saved details.');
  return {snapshot,finalNetPay:net/100,grossPay:gross/100,totalDeductions:deducted/100};
}
function ownerKey(api){
  const user=api.auth?.currentUser,session=api.sessionUser;
  if(!user?.uid||String(user.email||'').toLowerCase()!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||String(session.email||'').toLowerCase()!==OWNER_EMAIL||session.isOwner!==true||session.isFranchisee===true)throw Error('The verified Owner must save and share this payslip.');
  return JSON.stringify([user.uid,user.email,session]);
}
function fresh(snapshot){if(!snapshot||typeof snapshot.exists!=='function'||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Reconnect to confirm the saved payslip before sharing.');return snapshot;}
export async function readStaffPayslipPublication(api,{data,assertCurrent=()=>{}}={}){
  const actor=ownerKey(api),guard=()=>{assertCurrent();if(ownerKey(api)!==actor)throw Error('The Owner account changed. Reopen the payslip.');};guard();
  const key=staffPayslipPreviewId(data?.staffId,data?.start,data?.end),saved=fresh(await readDeadline(api.getDocFromServer(api.doc(api.db,'staff_payslip_previews',key))));guard();
  const row=saved.exists()?saved.data():null;
  if(row&&(row.staffId!==data.staffId||row.startDate!==data.start||row.endDate!==data.end||!Number.isSafeInteger(row.revision)||row.revision<1))throw Error('The saved shared payslip reference needs Owner review.');
  return {id:key,revision:row?.revision||0,publication:row};
}
export function publishStaffPayslip(api,{data,finalNetPay,expectedRevision,assertCurrent=()=>{}}={}){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)return Promise.reject(Error('Read the saved publication before sharing this payslip.'));
  let prepared,actor;try{prepared=prepareSharedPayslip(data,finalNetPay);actor=ownerKey(api);assertCurrent();}catch(error){return Promise.reject(error);}
  const copied=clone(data),key=staffPayslipPreviewId(copied.staffId,copied.start,copied.end),intent=JSON.stringify([actor,key,expectedRevision,prepared]);
  const flights=pending.get(api)||new Map();pending.set(api,flights);const prior=flights.get(key);
  if(prior)return prior.intent===intent?prior.promise:Promise.reject(Error('The earlier payslip save is still being confirmed. Wait before sharing changed figures.'));
  const guard=()=>{assertCurrent();if(ownerKey(api)!==actor)throw Error('The Owner account or payroll selection changed. Reopen the payslip.');};
  const promise=Promise.resolve().then(async()=>{
    guard();
    // Check legacy references too, without writing to payment records. Modern
    // payment IDs are always read again inside the publication transaction.
    if(typeof api.getDocsFromServer!=='function')throw Error('Reconnect to check saved payroll before sharing.');
    const paidIds=new Set(),profile=copied.profile||{},aliases=[...new Set([copied.name,profile.cashierName,profile.fullName,profile.name,profile.scheduleNickname,profile.scheduleName,profile.nickname,...(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[])].map(text).filter(Boolean))];
    if(aliases.length>10)throw Error('This employee has too many saved names for one safe payroll check. Ask HQ to confirm the identity.');
    const candidates=new Map();
    const references=[['staffId',copied.staffId,'=='],['frozenData.staffId',copied.staffId,'=='],['frozenData.profile.staffId',copied.staffId,'=='],['frozenData.profile.id',copied.staffId,'=='],['staffName',aliases,'in'],['frozenData.name',aliases,'in']];
    const results=await readDeadline(Promise.all(references.map(([field,value,operator])=>api.getDocsFromServer(api.query(api.collection(api.db,'payroll_records'),api.where(field,operator,value),...(api.limit?[api.limit(251)]:[]))))));guard();
    for(const result of results){
      if(result?.metadata?.fromCache||result?.metadata?.hasPendingWrites||!Array.isArray(result?.docs)||result.docs.length>250)throw Error('The saved payroll history is incomplete or too large. Ask HQ to review it before sharing.');
      for(const row of result.docs){if(row.metadata?.fromCache||row.metadata?.hasPendingWrites)throw Error('A saved payroll record is still syncing.');candidates.set(row.id,{...row.data(),id:row.id});}
    }
    for(const row of candidates.values()){
      const frozen=row.frozenData||{},ids=[row.staffId,frozen.staffId,frozen.profile?.staffId,frozen.profile?.id].filter(Boolean);
      if(ids.length?!ids.includes(copied.staffId):!aliases.includes(text(row.staffName||frozen.name)))continue;
      const from=row.startDate??frozen.start??frozen.startDate,to=row.endDate??frozen.end??frozen.endDate;
      if(!validRateDate(from)||!validRateDate(to)||from>to||[frozen.start,frozen.startDate].some(value=>value!=null&&value!==from)||[frozen.end,frozen.endDate].some(value=>value!=null&&value!==to)||ids.some(value=>value!==copied.staffId))throw Error('An older saved payroll has conflicting identity or cutoff details. Ask HQ to review it before sharing.');
      if(from===copied.start&&to===copied.end)paidIds.add(id(row.id));
    }
    const ref=(table,value)=>api.doc(api.db,table,value),ordinary='payroll-'+key,refund='refund-payroll-'+key;
    return api.runTransaction(api.db,async tx=>{
      guard();const [saved,person,...paid]=await Promise.all([tx.get(ref('staff_payslip_previews',key)),tx.get(ref('cashiers',copied.staffId)),...[...new Set([ordinary,refund,...paidIds])].map(value=>tx.get(ref('payroll_records',value)))]);guard();
      if(paid.some(row=>row.exists()))throw Error('This cutoff already has a saved payroll record. Open its paid payslip; shared drafts cannot replace it.');
      if(!person.exists()||text(person.data().cashierName||person.data().fullName||person.data().name)!==copied.name||person.data().branch!==copied.branch)throw Error('The saved employee identity or branch changed. Reopen payroll.');
      const live=person.data(),profile=copied.profile||{};
      if(profile.salaryRateVersion===1?live.salaryRateVersion!==1||live.salaryRateRevision!==profile.salaryRateRevision:live.salaryRateVersion===1||dailyStaffRate(live)===null||dailyStaffRate(live)!==dailyStaffRate(profile))throw Error('Salary details changed. Generate a fresh payslip before sharing.');
      const before=saved.exists()?saved.data():null;
      if((before?.revision||0)!==expectedRevision||before&&(before.staffId!==copied.staffId||before.startDate!==copied.start||before.endDate!==copied.end))throw Error('Another saved payslip changed while you reviewed it. Reopen Save & share before replacing it.');
      const record={schemaVersion:1,kind:'owner-shared-payslip',status:'Published',staffId:copied.staffId,staffName:copied.name,branch:copied.branch,startDate:copied.start,endDate:copied.end,
        revision:expectedRevision+1,publishedAt:api.serverTimestamp(),publishedByUid:api.auth.currentUser.uid,publishedByEmail:api.auth.currentUser.email.toLowerCase(),snapshot:prepared.snapshot,finalNetPay:prepared.finalNetPay};
      guard();tx.set(ref('staff_payslip_previews',key),record);
      return {id:key,revision:record.revision,...prepared};
    });
  });
  flights.set(key,{intent,promise});promise.finally(()=>{if(flights.get(key)?.promise===promise)flights.delete(key);}).catch(()=>{});return promise;
}
