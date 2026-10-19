import {resolveHQAccount} from './hq-account-model.js';
import {createWorkspaceSession,canOpenHrTab,OWNER_EMAIL} from './workspace-access-model.js';
import {dailyStaffRate,validRateDate,validateSalaryTimeline} from './staff-rate-model.js';
import {isMealDeduction} from './payroll-safety.js';

export const PAYROLL_SETTLEMENT_LIMITS=Object.freeze({rows:140,queryRows:250,readConcurrency:8,timeoutMs:25000,maxCents:1000000000000,documentBytes:750000});
const pending=new WeakMap(),text=value=>String(value??'').trim();
const id=value=>{if(typeof value!=='string'||!/^[-\w]{1,180}$/.test(value))throw Error('Reopen payroll using the saved employee and account IDs.');return value;};
const email=value=>text(value).toLowerCase();
const millis=value=>value?.toMillis?.()??value?.toDate?.()?.getTime?.()??(value?.seconds!=null?value.seconds*1000:Date.parse(value));
const json=value=>JSON.parse(JSON.stringify(value));
const amount=(value,{negative=false}={})=>{if(value==null||value==='')value=0;if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))throw Error('Payroll amounts must be valid numbers.');const cents=Math.round(Number(value)*100);if(!Number.isSafeInteger(cents)||Math.abs(cents)>PAYROLL_SETTLEMENT_LIMITS.maxCents||!negative&&cents<0)throw Error('Payroll amounts are outside the permitted range.');return cents;};
export function ordinaryPayrollId(staffId,start,end){id(staffId);if(!validRateDate(start)||!validRateDate(end)||start>end)throw Error('Choose a valid payroll cutoff.');return id('payroll-'+staffId+'-'+start+'-'+end);}
const refundId=(staffId,start,end)=>id('refund-payroll-'+staffId+'-'+start+'-'+end);
const safeProfile=profile=>Object.fromEntries(['staffId','id','cashierName','role','dateHired','hourlyRate','salaryRateVersion','salaryRateRevision','sssAmount','pagibigAmount','philHealthAmount','eligibleNightDiff','nightDiffRate','customDeductions'].filter(key=>profile?.[key]!==undefined).map(key=>[key,json(profile[key])]));
export function validateOrdinaryPayrollSnapshot(data,finalNetPay){
 if(!data||!text(data.name)||!text(data.branch)||data.attendanceReviewRequired)throw Error('This unpaid payslip needs HR review before payment.');
 if((data.onlineRefundRows||[]).length||amount(data.onlineRefunds)>0)throw Error('Use the protected refund-payroll workflow for online refund deductions.');
 const frozen=json(data),fields=['basicPay','nightBonus','straightBonus','holidayPayTotal','perfBonus','lateDeduction','sss','philhealth','pagibig','advances','meals','loans'];
 for(const key of fields)frozen[key]=amount(data[key])/100;
 const details=data.customDeductions??data.profile?.customDeductions??[];
 if(!Array.isArray(details)||details.length>100)throw Error('Review the custom deduction details before paying.');
 const custom=details.map(row=>{if(!row||!text(row.name)||text(row.name).length>200)throw Error('Each custom deduction needs its saved label.');return {name:text(row.name),amount:amount(row.amount)/100};});
 const customCents=custom.reduce((sum,row)=>sum+amount(row.amount),0);
 if(data.customDeductionsTotal!==undefined&&amount(data.customDeductionsTotal)!==customCents)throw Error('Custom deduction details do not match the payslip total.');
 const gross=['basicPay','nightBonus','straightBonus','holidayPayTotal','perfBonus'].reduce((sum,key)=>sum+amount(frozen[key]),0);
 const deducted=['lateDeduction','sss','philhealth','pagibig','advances','meals','loans'].reduce((sum,key)=>sum+amount(frozen[key]),customCents);
 const net=amount(finalNetPay);if(gross-deducted!==net)throw Error('The edited payslip total changed. Recalculate it before payment.');
 frozen.profile={...safeProfile(data.profile||{}),customDeductions:custom};frozen.customDeductions=custom;frozen.customDeductionsTotal=customCents/100;frozen.isPaid=true;frozen.finalNetPay=net/100;
 if(new TextEncoder().encode(JSON.stringify(frozen)).length>PAYROLL_SETTLEMENT_LIMITS.documentBytes)throw Error('This payslip is too large for one payment. Ask HQ to review its attendance detail.');
 return frozen;
}
// A saved payment wins over new edits. Return its frozen figures, never rewrite
// historical payroll or infer another payable amount from the current form.
export function confirmedPayrollResult(record,{id:recordId,staffId,start,end,legacyName}={}){
 const frozen=record?.frozenData;
 if(!record||record.startDate!==start||record.endDate!==end||!frozen||typeof frozen!=='object'||Array.isArray(frozen)||frozen.isPaid===false)throw Error('An incomplete saved payroll record needs HQ review before another payment.');
 const ids=[record.staffId,frozen.staffId,frozen.profile?.staffId].filter(Boolean);
 if(ids.length?ids.some(value=>value!==staffId):!legacyName||text(record.staffName||frozen.name)!==legacyName)throw Error('The saved payroll identity is ambiguous. Ask HQ to review it.');
 if(record.staffName&&frozen.name&&text(record.staffName)!==text(frozen.name))throw Error('The saved payroll names do not agree. Ask HQ to review them.');
 if(record.finalNetPay==null||text(record.finalNetPay)===''||frozen.finalNetPay!=null&&(text(frozen.finalNetPay)===''||amount(frozen.finalNetPay)!==amount(record.finalNetPay)))throw Error('The saved payment amount needs HQ review.');
 const finalNetPay=amount(record.finalNetPay)/100;
 return {id:recordId,alreadyPaid:true,frozenData:{...json(frozen),isPaid:true},finalNetPay,accountId:record.accountId,accountName:record.accountName};
}
async function parallel(jobs,guard){const values=new Array(jobs.length);let next=0,failure,failed=false;await Promise.all(Array.from({length:Math.min(PAYROLL_SETTLEMENT_LIMITS.readConcurrency,jobs.length)},async()=>{while(!failed&&next<jobs.length){const index=next++;try{guard();values[index]=await jobs[index]();guard();}catch(error){if(!failed){failed=true;failure=error;}}}}));if(failed)throw failure;return values;}
function rows(snapshot){if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||!Array.isArray(snapshot.docs)||snapshot.docs.length>PAYROLL_SETTLEMENT_LIMITS.queryRows)throw Error('The current payroll records could not be confirmed completely. Reconnect and refresh payroll.');return snapshot.docs.map(row=>{if(row.metadata?.fromCache||row.metadata?.hasPendingWrites)throw Error('Payroll includes an unconfirmed saved row. Refresh before payment.');return {...row.data(),id:id(row.id)};});}
function actor(api){const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||!user.email||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||email(session.email)!==email(user.email)||session.isFranchisee===true||!canOpenHrTab(session,'Feed'))throw Error('Sign in with your approved Google payroll account before paying.');return {uid:user.uid,email:email(user.email),key:JSON.stringify([user.uid,email(user.email),session.uid,email(session.email),session.permissions,session.allowedBranches,session.role,session.isOwner,session.isFranchisee])};}
function authorized(api,identity,hq,grant,branches){const current=actor(api);if(current.key!==identity.key)throw Error('Your payroll account or permissions changed. Reopen the payslip.');const account=resolveHQAccount(hq.map(row=>({id:row.id,data:row})));if(account.active===false||account.blocked===true||/^(blocked|revoked)$/i.test(text(account.pin))||/blocked|revoked|disabled|inactive/i.test(text(account.status)))throw Error('Your saved HQ account cannot pay payroll.');const saved=createWorkspaceSession(api.auth.currentUser,account);if(saved.isFranchisee||!canOpenHrTab(saved,'Feed'))throw Error('Your saved HQ permissions do not allow payroll payment.');if(identity.email!==OWNER_EMAIL){if(grant?.active!==true||!grant.permissions?.some(value=>['all','payroll','feed'].includes(value))||!Array.isArray(grant.allowedBranches))throw Error('Your protected payroll access needs Owner review.');for(const branch of branches)if(!saved.allowedBranches.includes('All')&&!saved.allowedBranches.includes(branch)||!grant.allowedBranches.includes('All')&&!grant.allowedBranches.includes(branch))throw Error('The employee or payment account is outside your assigned payroll branches.');}}
function belongs(row,data){const keys=[row.staffId,row.frozenData?.staffId,row.frozenData?.profile?.staffId].filter(Boolean);if(keys.length){if(keys.includes(data.staffId)&&keys.some(value=>value!==data.staffId))throw Error('Saved payroll has conflicting employee IDs. Ask HQ to review it.');return keys.includes(data.staffId);}const savedName=text(row.staffName||row.frozenData?.name);if(savedName.toLowerCase()===data.name.toLowerCase()&&savedName!==data.name)throw Error('A saved payment uses a different spelling of this employee name. Ask HR to confirm it.');return savedName===data.name;}
function allocation(rows,total,label){let remaining=amount(total);const result=[];for(const row of rows){if(!remaining)break;const original=amount(row.amount),taken=Math.min(original,remaining);if(!taken)continue;result.push({id:row.id,original,taken,remaining:original-taken,row});remaining-=taken;}if(remaining)throw Error(label+' changed. Refresh this unpaid payslip before paying.');return result;}
function staffRow(row,data){if(row.staffId&&row.staffId!==data.staffId)throw Error('A payroll item belongs to another employee ID. Ask HQ to review it.');if(text(row.staffName)!==data.name||row.branch&&row.branch!==data.branch)throw Error('A payroll item belongs to another employee or branch.');}

async function settle(api,input,identity,guard){
 const {data,accountId,finalNetPay,allowNegativeBalance=false}=input,recordId=ordinaryPayrollId(data.staffId,data.start,data.end),ref=(table,key)=>api.doc(api.db,table,key);
 const query=(table,filters)=>api.query(api.collection(api.db,table),...filters.map(([key,value])=>api.where(key,'==',value)),...(typeof api.limit==='function'?[api.limit(PAYROLL_SETTLEMENT_LIMITS.queryRows+1)]:[]));
 const readQuery=async reference=>rows(await api.getDocsFromServer(reference));
 const note=`Payslip for ${data.name} (${data.start} to ${data.end}) - Branch: ${data.branch}`;
 const jobs=[()=>readQuery(query('hq_managers',[['email',identity.email]])),()=>readQuery(query('payroll_records',[['startDate',data.start],['endDate',data.end]])),()=>readQuery(query('payroll_records',[['staffId',data.staffId]])),()=>readQuery(query('payroll_records',[['staffName',data.name]])),()=>readQuery(query('cashiers',[['cashierName',data.name]])),()=>readQuery(query('expenses',[['note',note]]))];
 if(identity.email!==OWNER_EMAIL)jobs.push(async()=>{const snap=await api.getDocFromServer(ref('hq_email_access',identity.email));if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('HQ access could not be confirmed.');return snap.exists()?snap.data():null;});else jobs.push(async()=>null);
 jobs.push(()=>readQuery(query('staff_deductions',[['staffName',data.name],['status','Unpaid']])));
 jobs.push(()=>readQuery(query('staff_bonuses',[['staffName',data.name],['status','Unpaid']])));
 jobs.push(()=>amount(data.loans)&&!data.ledgerId?readQuery(query('staff_ledger',[['staffName',data.name]])):[]);
 const [hq,cutoff,byId,byName,directory,expenses,grant,deductions,bonuses,loans]=await parallel(jobs,guard);
 authorized(api,identity,hq,grant,[data.branch]);
 if(directory.length!==1||directory[0].id!==data.staffId)throw Error('This payroll name does not identify one saved employee. Ask HR to separate the profiles.');
 const history=[...new Map([...cutoff,...byId,...byName].filter(row=>belongs(row,data)).map(row=>[row.id,row])).values()];
 const end=Date.parse(data.end+'T23:59:59.999+08:00'),start=Date.parse(data.start+'T00:00:00+08:00');
 const eligibleDeductions=deductions.filter(row=>row.status==='Unpaid'&&millis(row.dateAdded??row.timestamp)<=end&&(row.type==='Cash Advance'||isMealDeduction(row.type))).sort((a,b)=>millis(a.dateAdded??a.timestamp)-millis(b.dateAdded??b.timestamp)||a.id.localeCompare(b.id));
 const eligibleBonuses=bonuses.filter(row=>row.status==='Unpaid'&&row.type==='Performance Bonus'&&millis(row.dateAdded)>=start&&millis(row.dateAdded)<=end+12*3600000).sort((a,b)=>millis(a.dateAdded)-millis(b.dateAdded)||a.id.localeCompare(b.id));
 for(const row of [...eligibleDeductions,...eligibleBonuses])staffRow(row,data);
 if(eligibleDeductions.length+eligibleBonuses.length+history.length>PAYROLL_SETTLEMENT_LIMITS.rows)throw Error('This payroll has too many linked records for one safe payment. Ask HQ to reconcile it.');
 const ledgerId=data.ledgerId||loans.length===1&&loans[0].id;
 if(amount(data.loans)&&!ledgerId)throw Error('The company loan ledger is missing or ambiguous.');
 const references=[ref('payroll_records',recordId),ref('payroll_records',refundId(data.staffId,data.start,data.end)),ref('cash_accounts',accountId),ref('cashiers',data.staffId),ref('expenses',recordId),...hq.map(row=>ref('hq_managers',row.id)),...(identity.email!==OWNER_EMAIL?[ref('hq_email_access',identity.email)]:[]),...history.map(row=>ref('payroll_records',row.id)),...expenses.filter(row=>row.category==='Payroll').map(row=>ref('expenses',row.id)),...eligibleDeductions.map(row=>ref('staff_deductions',row.id)),...eligibleBonuses.map(row=>ref('staff_bonuses',row.id)),...(amount(data.loans)?[ref('staff_ledger',id(ledgerId))]:[])];
 const unique=[...new Map(references.map(reference=>[(reference.path||JSON.stringify(reference)),reference])).values()];
 const result=await api.runTransaction(api.db,async tx=>{
  const snapshots=await parallel(unique.map(reference=>()=>tx.get(reference)),guard),saved=new Map(unique.map((reference,index)=>[reference.path||JSON.stringify(reference),snapshots[index]]));
  const get=(table,key)=>{const snap=saved.get((ref(table,key).path||JSON.stringify(ref(table,key))));return snap?.exists()?snap.data():null;};
  const person=get('cashiers',data.staffId),account=get('cash_accounts',accountId);
  if(!person||text(person.cashierName||person.fullName||person.name)!==data.name||person.branch!==data.branch)throw Error('The saved employee identity or branch changed. Regenerate payroll.');
  const freshHQ=hq.map(row=>{const fresh=get('hq_managers',row.id);if(!fresh)throw Error('Your saved HQ authorization changed.');return {...fresh,id:row.id};});
  authorized(api,identity,freshHQ,identity.email===OWNER_EMAIL?null:get('hq_email_access',identity.email),[data.branch]);
  const own=get('payroll_records',recordId),refund=get('payroll_records',refundId(data.staffId,data.start,data.end));
  const existing=history.map(row=>{const fresh=get('payroll_records',row.id);if(!fresh||!belongs(fresh,data)||fresh.startDate!==row.startDate||fresh.endDate!==row.endDate||JSON.stringify(fresh.frozenData)!==JSON.stringify(row.frozenData)||fresh.finalNetPay!==row.finalNetPay)throw Error('A saved payroll record changed during payment. Refresh before continuing.');return {...fresh,id:row.id};});
  if(own&&refund||(own||refund)&&existing.some(row=>row.id!==recordId&&row.id!==refundId(data.staffId,data.start,data.end)&&row.startDate===data.start&&row.endDate===data.end))throw Error('More than one saved payment covers this cutoff. Ask HQ to review it.');
  if(own||refund){const paid=own||refund;authorized(api,identity,freshHQ,identity.email===OWNER_EMAIL?null:get('hq_email_access',identity.email),[data.branch,paid.branch||paid.frozenData?.branch||data.branch]);return confirmedPayrollResult(paid,{id:own?recordId:refundId(data.staffId,data.start,data.end),staffId:data.staffId,start:data.start,end:data.end});}
  const exact=existing.filter(row=>row.startDate===data.start&&row.endDate===data.end);
  if(exact.length>1)throw Error('Duplicate saved payroll records need HQ review. No new payment was made.');
  if(exact.length){const row=exact[0];authorized(api,identity,freshHQ,identity.email===OWNER_EMAIL?null:get('hq_email_access',identity.email),[data.branch,row.branch||row.frozenData?.branch||data.branch]);return confirmedPayrollResult(row,{id:row.id,staffId:data.staffId,start:data.start,end:data.end,legacyName:data.name});}
  if(data.isPaid)throw Error('This saved payslip is read-only. Refresh payroll to confirm its payment record.');
  if(deductions.some(row=>row.status==='Unpaid'&&row.type==='Online Order Refund'&&millis(row.dateAdded??row.timestamp)<=end&&(!row.staffId||row.staffId===data.staffId)))throw Error('Online refund deductions changed. Regenerate payroll and use its protected refund workflow.');
  if(existing.some(row=>!validRateDate(row.startDate)||!validRateDate(row.endDate)||row.startDate<=data.end&&row.endDate>=data.start))throw Error('Saved payroll overlaps these dates or needs HR review. Choose an unpaid cutoff.');
  if(get('expenses',recordId)||expenses.some(row=>row.category==='Payroll'&&get('expenses',row.id)))throw Error('A payroll expense already exists without its confirmed payslip. Ask HQ to review it before paying again.');
  if(!account||!text(account.name))throw Error('The selected payment account is unavailable.');
  authorized(api,identity,freshHQ,identity.email===OWNER_EMAIL?null:get('hq_email_access',identity.email),[data.branch,account.branch||'Unassigned']);
  if(account.balance==null||account.balance==='')throw Error('The current payment account balance is invalid.');const balance=amount(account.balance,{negative:true}),net=amount(finalNetPay);if(!allowNegativeBalance&&balance<net)throw Error('The current account balance is too low. Review it before confirming a negative balance.');
  if(person.salaryRateVersion===1){const salary=await tx.get(ref('staff_salary_rates',data.staffId));guard();if(data.profile?.salaryRateVersion!==1||person.salaryRateRevision!==data.profile?.salaryRateRevision||!salary.exists())throw Error('Salary dates changed. Regenerate this unpaid payslip.');const timeline=validateSalaryTimeline(salary.data());if(timeline.staffId!==data.staffId||timeline.branch!==data.branch||timeline.revisionId!==person.salaryRateRevision)throw Error('Private salary history needs HQ review.');}
  else if(data.profile?.salaryRateVersion===1||dailyStaffRate(person)!==dailyStaffRate(data.profile))throw Error('The saved daily wage changed. Regenerate this unpaid payslip.');
  const frozen=validateOrdinaryPayrollSnapshot(data,finalNetPay),freshDeductions=eligibleDeductions.map(row=>{const fresh=get('staff_deductions',row.id);if(!fresh||fresh.status!=='Unpaid'||fresh.type!==row.type||amount(fresh.amount)!==amount(row.amount))throw Error('A meal or advance changed. Regenerate payroll.');staffRow(fresh,data);return {...fresh,id:row.id};});
  const allocations=[...allocation(freshDeductions.filter(row=>row.type==='Cash Advance'),data.advances,'Cash advances'),...allocation(freshDeductions.filter(row=>isMealDeduction(row.type)),data.meals,'Foods deductions')];
  const freshBonuses=eligibleBonuses.map(row=>{const fresh=get('staff_bonuses',row.id);if(!fresh||fresh.status!=='Unpaid'||fresh.type!==row.type||amount(fresh.amount)!==amount(row.amount))throw Error('A performance bonus changed. Regenerate payroll.');staffRow(fresh,data);return {...fresh,id:row.id};});
  const savedBonusTotal=freshBonuses.reduce((sum,row)=>sum+amount(row.amount),0),sourceBonus=amount(input.sourcePerfBonus??data.sourcePerfBonus??data.perfBonus);
  if(savedBonusTotal!==sourceBonus)throw Error('The saved performance bonuses changed. Regenerate this unpaid payslip.');
  if(amount(data.perfBonus)<sourceBonus)throw Error('The edited performance amount is below its saved rewards. Ask HQ to review them before paying.');
  const bonusAllocations=allocation(freshBonuses,sourceBonus/100,'Performance bonuses');frozen.sourcePerfBonus=sourceBonus/100;frozen.manualPerformanceBonus=(amount(data.perfBonus)-sourceBonus)/100;
  const loan=amount(data.loans)?get('staff_ledger',ledgerId):null;
  if(amount(data.loans)){if(!loan||text(loan.staffName)!==data.name||loan.staffId&&loan.staffId!==data.staffId||loan.branch&&loan.branch!==data.branch||amount(loan.totalLoaned)-amount(loan.totalPaid)<amount(data.loans))throw Error('The company loan balance changed. Regenerate payroll.');}
  guard();const stamp=api.serverTimestamp(),accountBalance=(balance-net)/100,settlements=allocations.map(row=>({id:row.id,amount:row.taken/100}));
  tx.set(ref('payroll_records',recordId),{staffId:data.staffId,staffName:data.name,branch:data.branch,startDate:data.start,endDate:data.end,frozenData:frozen,finalNetPay:net/100,accountId,accountName:account.name,deductionSettlements:settlements,processedAt:stamp,processedBy:identity.email,acknowledged:false,payrollVersion:2});
  tx.update(ref('cash_accounts',accountId),{balance:accountBalance});
  tx.set(ref('expenses',recordId),{branch:'Main Office',amount:net/100,category:'Payroll',account:account.name,note,staffId:data.staffId,payrollRecordId:recordId,timestamp:stamp});
  for(const row of allocations)tx.update(ref('staff_deductions',row.id),row.remaining?{amount:row.remaining/100}:{status:'Paid',paidAt:stamp,payrollRecordId:recordId});
  for(const row of bonusAllocations)tx.update(ref('staff_bonuses',row.id),row.remaining?{amount:row.remaining/100}:{status:'Paid',paidAt:stamp,payrollRecordId:recordId});
  if(loan){tx.update(ref('staff_ledger',ledgerId),{totalPaid:(amount(loan.totalPaid)+amount(data.loans))/100});tx.set(ref('staff_deductions',recordId+'-loan'),{staffId:data.staffId,staffName:data.name,branch:data.branch,type:'Company Loan Payment',amount:amount(data.loans)/100,status:'Paid',dateAdded:stamp,paidAt:stamp,remarks:'Auto-deducted from payslip',payrollRecordId:recordId});}
  return {id:recordId,alreadyPaid:false,frozenData:frozen,finalNetPay:net/100,accountId,accountName:account.name,accountBalance};
 });return result;
}

export function finalizeOrdinaryPayroll(api,{data,accountId,finalNetPay,sourcePerfBonus,allowNegativeBalance=false,assertCurrent=()=>{}}={}){
 try{
  if(typeof api.getDocsFromServer!=='function'||typeof api.getDocFromServer!=='function'||typeof api.runTransaction!=='function')throw Error('Reconnect to HQ before paying payroll.');
  if(typeof allowNegativeBalance!=='boolean')throw Error('Confirm the payment account balance before continuing.');const identity=actor(api),copied=json(data),recordId=ordinaryPayrollId(copied.staffId,copied.start,copied.end);id(accountId);copied.name=text(copied.name);copied.branch=text(copied.branch);
  const guard=()=>{assertCurrent();if(actor(api).key!==identity.key)throw Error('Your payroll account or permissions changed. Reopen the payslip.');};guard();
  const intent=JSON.stringify([accountId,amount(finalNetPay),sourcePerfBonus,allowNegativeBalance,copied]),map=pending.get(api)||new Map();pending.set(api,map);const key=identity.uid+'|'+recordId;
  let entry=map.get(key);if(entry&&entry.intent!==intent)throw Error('This payslip payment is already being checked with different edits. Wait for its result before retrying.');
  if(!entry){entry={intent};entry.physical=settle(api,{data:copied,accountId,finalNetPay,sourcePerfBonus,allowNegativeBalance},identity,guard);map.set(key,entry);entry.physical.finally(()=>{if(map.get(key)===entry)map.delete(key);}).catch(()=>{});}
  let timer;return Promise.race([entry.physical,new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Error('HQ has not confirmed this payment yet. Refresh saved payroll before retrying; do not make another payment.');error.code='payroll-settlement-unconfirmed';reject(error);},PAYROLL_SETTLEMENT_LIMITS.timeoutMs);})]).finally(()=>clearTimeout(timer));
 }catch(error){return Promise.reject(error);}
}

// Fresh server queries detect existing and overlapping payments. A client-side
// transaction cannot lock a query against a concurrently inserted random-ID
// record, or a different overlapping cutoff ID. Same-cutoff current routes share
// explicit sentinels; strict cross-cutoff/cross-version exclusion needs a separate
// per-employee migration/Rules protocol, which this engine does not claim.
