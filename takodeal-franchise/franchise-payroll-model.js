// Read-only projection. This module never settles payroll or changes a ledger.
import {attendanceEstimate} from './franchise-data.js';
import {dailyStaffRate,validRateDate} from './staff-rate-model.js';
import {isMealDeduction} from './payroll-safety.js';
import {isPenaltyDeduction,deductionIsDue} from './sanction-schedule.js';

const text=value=>String(value??'').trim();
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const cents=(value,label,{optional=false}={})=>{
 if(optional&&(value===undefined||value===null||value===''))return 0;
 if(!['string','number'].includes(typeof value)||text(value)===''||typeof value==='string'&&!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())||!Number.isFinite(Number(value))||Number(value)<0||!Number.isSafeInteger(Math.round(Number(value)*100)))throw Error(label+' needs HQ review.');
 return Math.round(Number(value)*100);
};
const stamp=value=>{if(value==null||value==='')return null;const n=value?.toMillis?.()??(value?.seconds!=null?Number(value.seconds)*1000:+new Date(value));return Number.isFinite(n)?n:null;};
const idOf=staff=>text(staff?.id||staff?.staffId);
const nameOf=staff=>text(staff?.cashierName||staff?.fullName||staff?.name);
const moneyRow=(key,label,value,details=[],note='')=>({key,label,amount:value/100,details,note});
const categories=[['lateDeduction','Late / undertime'],['sss','SSS'],['philhealth','PhilHealth'],['pagibig','Pag-IBIG'],['advances','Cash advances'],['loans','Company loan'],['meals','Meals and cancelled food purchases'],['onlineRefunds','Online order refunds'],['cashShortages','Approved cash shortages']];
const bucket=row=>row.bucket||(isMealDeduction(row.type)?'meals':row.type==='Cash Advance'?'advances':row.type==='Online Order Refund'?'onlineRefunds':row.type==='Cash Shortage'?'cashShortages':null);
function detail(row){
 const source=row.purchasedItems||row.items||row.selectedItems||row.cart||[];
 const items=(Array.isArray(source)?source:[]).slice(0,200).flatMap(item=>{
  const qty=Number(item?.qty??item?.quantity),name=text(item?.name||item?.itemName||item?.label);if(!name||!Number.isFinite(qty)||qty<=0)return [];
  const options=Array.isArray(item.addons)?item.addons.map(a=>['',a]):item.addons&&typeof item.addons==='object'?Object.entries(item.addons):[];
  return [{qty,name,variant:text(item.variantName||item.variant||item.size),notes:text(item.notes),options:options.filter(([,a])=>a!==null&&a!==undefined&&a!==false&&a!==0).map(([key,a])=>text(typeof a==='object'?a.name||a.itemName||key:typeof a==='string'?a:key)).filter(Boolean),...(item.amount!==undefined?{amount:cents(item.amount,'Saved food item')/100}:{})}];
 });
 return {id:text(row.id),type:text(row.type||row.label),amount:cents(row.amount,'Saved deduction')/100,platform:text(row.sourcePlatform),receipt:text(row.sourceReceiptId||row.receiptId),date:stamp(row.dateAdded||row.timestamp),description:text(row.item||row.remarks),items,...(row.purchaseAmount!==undefined?{purchaseAmount:cents(row.purchaseAmount,'Saved purchase')/100}:{}),originalOptions:isMealDeduction(row.type)&&/^cancelled/i.test(text(row.type))&&items.some(item=>item.options.length>0)};
}
function customRows(source,total){
 if(source!=null&&!Array.isArray(source))throw Error('Custom deduction details need HQ review.');
 const rows=Array.isArray(source)?source:[];
 const named=rows.map((row,index)=>moneyRow('custom-'+index,text(row.name)||'Unlabelled saved custom deduction',cents(row.amount,'Custom deduction'))).filter(row=>row.amount>0);
 const sum=named.reduce((value,row)=>value+Math.round(row.amount*100),0),expected=total===undefined?sum:cents(total,'Saved custom deduction total');
 return expected===sum?named:expected?[moneyRow('custom','Other saved custom deductions',expected,[],'The saved total has no matching itemized labels. Ask HQ for the original detail.')]:[];
}
function attendanceRows(logs){return (Array.isArray(logs)?logs:[]).map(row=>({in:stamp(row.in),out:stamp(row.out),hours:row.hours!=null&&Number.isFinite(Number(row.hours))?Number(row.hours):null,workDate:text(row.rateWorkDate||row.workDate),dailyRate:dailyStaffRate({hourlyRate:row.dailyRate}),remark:text(row.remark||row.remarks)}));}
function rateRows(logs){const groups=new Map();for(const row of logs)if(row.dailyRate!==null){const key=String(row.dailyRate),entry=groups.get(key)||{dailyRate:row.dailyRate,shifts:0,workDates:[]};entry.shifts++;if(row.workDate&&!entry.workDates.includes(row.workDate))entry.workDates.push(row.workDate);groups.set(key,entry);}return [...groups.values()];}
function base(input){const staff=input.staff||{},staffId=idOf(staff),name=nameOf(staff),branch=text(input.branch);return {version:1,kind:'held',staffId,name,branch,start:input.start,end:input.end,recordId:'',paidDate:null,hours:null,shifts:null,incomeRows:[],deductionRows:[],attendanceRows:[],rateRows:[],totals:{basic:null,bonus:null,gross:null,deductions:null,net:null},reviewReasons:[],notes:[]};}
function held(model,reasons){return freeze({...model,kind:'held',incomeRows:[],deductionRows:[],totals:{basic:null,bonus:null,gross:null,deductions:null,net:null},reviewReasons:[...new Set(reasons.map(text).filter(Boolean))]});}
function savedModel(model,record,legacyVerified=false){
 const saved=record.frozenData,ids=[record.staffId,saved.staffId,saved.profile?.staffId,saved.profile?.id].filter(value=>value!=null&&text(value)!=='').map(text);
 if(ids.length?ids.some(value=>value!==model.staffId):!legacyVerified)throw Error('The saved payroll employee ID needs HQ review.');
 for(const value of [record.branch,saved.branch].filter(value=>value!=null))if(value!==model.branch)throw Error('The saved payroll branch needs HQ review.');
 if(![record.branch,saved.branch].includes(model.branch))throw Error('The saved payroll branch was not recorded.');
 if(record.startDate!==model.start||record.endDate!==model.end||saved.start!=null&&saved.start!==model.start||saved.end!=null&&saved.end!==model.end)throw Error('The saved payroll cutoff needs HQ review.');
 const income=[['basicPay','Basic pay'],['nightBonus','Mid / night bonus'],['straightBonus','Straight duty bonus'],['holidayPayTotal','Holiday pay'],['perfBonus','Performance / other saved bonus']].map(([key,label])=>moneyRow(key,label,cents(saved[key],label,{optional:key!=='basicPay'})));
 const details=saved.deductionDetailsVersion===1&&Array.isArray(saved.deductionDetails)?saved.deductionDetails:[];
 const deduction=categories.map(([key,label])=>{
  const value=cents(saved[key],label,{optional:true});let evidence=details.filter(row=>bucket(row)===key);
  if(!evidence.length&&key==='onlineRefunds')evidence=saved.onlineRefundRows||[];
  if(!evidence.length&&key==='cashShortages')evidence=saved.cashShortageRows||[];
  evidence=Array.isArray(evidence)?evidence.map(detail):[];
  const complete=evidence.length>0&&evidence.reduce((sum,row)=>sum+Math.round(row.amount*100),0)===value;
  return moneyRow(key,label,value,complete?evidence:[],value&&!complete&&['meals','advances','onlineRefunds','cashShortages'].includes(key)?'This older payslip saved the total without individual receipt details.':'');
 });
 deduction.push(...customRows(saved.customDeductions??saved.profile?.customDeductions,saved.customDeductionsTotal));
 const gross=income.reduce((sum,row)=>sum+Math.round(row.amount*100),0),deducted=deduction.reduce((sum,row)=>sum+Math.round(row.amount*100),0),net=cents(record.finalNetPay,'Saved net pay');
 if(saved.finalNetPay!=null&&cents(saved.finalNetPay,'Frozen net pay')!==net||gross-deducted!==net)throw Error('Saved payslip amounts do not reconcile. Ask HQ to review the original record.');
 const logs=attendanceRows(saved.logs);
 return freeze({...model,kind:'paid',name:text(saved.name||record.staffName)||model.name,recordId:text(record.id),paidDate:stamp(record.paidAt||record.processedAt),hours:saved.hours==null?null:Number(saved.hours),shifts:saved.shiftsWorked==null?null:Number(saved.shiftsWorked),incomeRows:income.filter(row=>row.amount>0||row.key==='basicPay'),deductionRows:deduction.filter(row=>row.amount>0),attendanceRows:logs,rateRows:rateRows(logs),totals:{basic:income[0].amount,bonus:(gross-Math.round(income[0].amount*100))/100,gross:gross/100,deductions:deducted/100,net:net/100},notes:['These figures come only from the saved payroll snapshot. Current rates, attendance and deductions are not used.']});
}

export function buildFranchisePayslip(input={}){
 const model=base(input),staff=input.staff||{},reasons=[];
 try{
  if(!model.staffId||!model.name||staff.staffId&&text(staff.staffId)!==model.staffId||staff.branch!==model.branch)throw Error('Choose one saved staff account in the selected branch.');
  if(!validRateDate(model.start)||!validRateDate(model.end)||model.start>model.end)throw Error('Choose a valid payroll cutoff.');
  const profiles=input.profiles||[staff];if(profiles.filter(row=>idOf(row)===model.staffId&&row.branch===model.branch).length!==1)throw Error('The saved employee identity is ambiguous. Ask HQ to review the profile.');
  const legacyIdentity=(name,branch)=>{
   if(name!==model.name||!Array.isArray(input.profiles))return false;
   const directory=profiles.filter(row=>nameOf(row)===name&&(branch?row.branch===branch:true));
   return (branch===model.branch||!branch&&input.identityDirectoryComplete===true)&&directory.length===1&&idOf(directory[0])===model.staffId;
  };
  const matches=(input.payrollRecords||[]).filter(row=>{
   const f=row.frozenData||{},ids=[row.staffId,f.staffId,f.profile?.staffId,f.profile?.id].filter(Boolean).map(text);
   return (ids.length?ids.includes(model.staffId):text(row.staffName||f.name)===model.name)&&(row.startDate??f.start)===model.start&&(row.endDate??f.end)===model.end&&(!row.branch||row.branch===model.branch)&&(!f.branch||f.branch===model.branch)&&row.isPaid!==false&&f.isPaid!==false&&!/^(draft|unpaid|pending|cancelled|canceled|voided|failed)$/i.test(text(row.status));
  });
  if(matches.length>1)throw Error('More than one saved payslip covers this employee and cutoff. Ask HQ to review it.');
  if(matches.length){if(!matches[0].frozenData||typeof matches[0].frozenData!=='object')throw Error('The saved payslip snapshot is missing. Ask HQ to review it.');const record=matches[0],aliases=[record.staffName,record.frozenData.name].filter(value=>value!=null&&text(value)!=='');return savedModel(model,record,aliases.every(value=>text(value)===model.name)&&legacyIdentity(text(record.staffName||record.frozenData.name),record.branch||record.frozenData.branch));}
  const select=(rows,label,keepPunchName=false)=>(rows||[]).flatMap(row=>{
   if(row.staffId){if(text(row.staffId)!==model.staffId)return [];if(row.branch!==model.branch){reasons.push(label+' has a missing or different branch.');return [];}return [{...row,staffName:keepPunchName?row.staffName||model.name:model.name}];}
   if(text(row.staffName)===model.name&&(!row.branch||row.branch===model.branch)){if(legacyIdentity(text(row.staffName),row.branch))return [{...row,staffId:model.staffId,branch:model.branch}];reasons.push(label+' has an ambiguous historical name or missing branch. HQ must confirm the employee ID.');}return [];
  });
  const cutoffEnd=Date.parse(model.end+'T16:00:00Z'),cutoffStart=Date.parse(model.start+'T00:00:00+08:00');
  const inPeriod=(row,end=cutoffEnd)=>stamp(row.timestamp??row.dateAdded)==null||stamp(row.timestamp??row.dateAdded)>=cutoffStart&&stamp(row.timestamp??row.dateAdded)<end;
  const logs=select((input.logs||[]).filter(row=>inPeriod(row,cutoffEnd+18*3600000)),'Attendance',true),allDeductions=select((input.deductions||[]).filter(row=>row.status==='Unpaid'&&(stamp(row.dateAdded)==null||stamp(row.dateAdded)<cutoffEnd)),'A deduction'),bonuses=select((input.bonuses||[]).filter(row=>inPeriod(row)),'A bonus'),ledgers=select(input.ledgers,'A loan ledger');
  // Earlier clock-ins are evidence only: a verified linked closure may belong
  // to the previous cutoff. They never enter this cutoff's payable starts.
  const referenceLogs=select((input.logs||[]).filter(row=>{const at=stamp(row.timestamp);return at==null||at>=cutoffStart-18*3600000&&at<cutoffEnd+18*3600000;}),'Attendance reference',true);
  if(logs.some(row=>stamp(row.timestamp)==null))reasons.push('An attendance timestamp is invalid. HQ must review the punch.');
  if(staff.salaryRateVersion!==1&&dailyStaffRate(staff)===null)reasons.push('The saved daily rate needs HQ review.');
  const due=allDeductions.filter(row=>row.status==='Unpaid'&&stamp(row.dateAdded)!=null&&stamp(row.dateAdded)<cutoffEnd&&deductionIsDue(row,model.end));
  for(const row of allDeductions)if(row.status==='Unpaid'&&stamp(row.dateAdded)==null)reasons.push('A deduction date is missing. HQ must confirm its cutoff.');
  for(const row of allDeductions)if(row.effectiveDate!=null&&!validRateDate(row.effectiveDate))reasons.push('A deduction effective date is invalid. HQ must confirm its cutoff.');
  const grouped=new Map(),notes=[];
  for(const row of due){
   if(isPenaltyDeduction(row)){if(deductionIsDue(row,model.end))notes.push('A scheduled disciplinary penalty needs separate HQ ledger review and is excluded.');continue;}
   const key=bucket(row);if(!key){reasons.push('A saved deduction type needs HQ review: '+text(row.type));continue;}
   const value=cents(row.amount,'Deduction amount'),group=grouped.get(key)||{value:0,details:[]};group.value+=value;group.details.push(detail(row));grouped.set(key,group);
  }
  for(const row of bonuses)if(stamp(row.dateAdded)==null)reasons.push('A bonus date is missing. HQ must confirm its cutoff.');else if(stamp(row.dateAdded)>=cutoffStart&&stamp(row.dateAdded)<cutoffEnd)cents(row.amount,'Bonus amount');
  if(ledgers.length>1)reasons.push('Multiple saved loan ledgers need HQ review.');
  const ledger=ledgers[0],loan=ledger?Math.max(0,Math.min(cents(ledger.cutoffDeduction,'Loan cutoff deduction',{optional:true}),cents(ledger.totalLoaned,'Loan principal')-cents(ledger.totalPaid,'Loan paid total',{optional:true}))):0;
  const fixed=[['sss','SSS','sssAmount'],['philhealth','PhilHealth','philHealthAmount'],['pagibig','Pag-IBIG','pagibigAmount']].map(([key,label,field])=>moneyRow(key,label,cents(staff[field],label,{optional:true})));
  fixed.push(...customRows(staff.customDeductions));
  const estimated=attendanceEstimate({logs,referenceLogs,profiles:[staff],deductions:[],bonuses,ledgers:[],schedule:input.schedule||{},holidays:input.holidays||{},start:model.start,end:model.end,branch:model.branch,calendarCutoff:true})[0]||{hours:0,shifts:0,basic:0,bonus:0,late:0,logs:[],review:0};
  if(estimated.attendanceHeld||estimated.attendanceReviewRequired||estimated.review>0)reasons.push(...(estimated.attendanceReviewReasons||[]),'Attendance or the saved schedule needs HR review before a payslip estimate can be shown.');
  if(reasons.length)return held(model,reasons);
  const basic=cents(estimated.basic,'Basic pay'),bonus=cents(estimated.bonus,'Bonuses'),late=cents(estimated.late,'Late / undertime');
  const savedBonuses=bonuses.filter(row=>stamp(row.dateAdded)>=cutoffStart&&stamp(row.dateAdded)<cutoffEnd).map((row,index)=>moneyRow('saved-bonus-'+index,text(row.type||row.reason)||'Saved bonus',cents(row.amount,'Saved bonus')));
  const savedBonusTotal=savedBonuses.reduce((sum,row)=>sum+Math.round(row.amount*100),0);if(savedBonusTotal>bonus)throw Error('Saved bonus details do not reconcile. Ask HQ to review them.');
  const deductions=[moneyRow('lateDeduction','Late / undertime',late),...fixed,moneyRow('loans','Company loan',loan),...categories.filter(([key])=>grouped.has(key)).map(([key,label])=>{const row=grouped.get(key);return moneyRow(key,label,row.value,row.details);})].filter(row=>row.amount>0);
  const total=deductions.reduce((sum,row)=>sum+Math.round(row.amount*100),0),attendance=attendanceRows(estimated.logs);
  return freeze({...model,kind:'estimate',hours:estimated.hours,shifts:estimated.shifts,incomeRows:[moneyRow('basicPay','Basic pay',basic),moneyRow('shift-bonus','Shift / holiday bonuses',bonus-savedBonusTotal),...savedBonuses].filter(row=>row.amount>0||row.key==='basicPay'),deductionRows:deductions,attendanceRows:attendance,rateRows:rateRows(attendance),totals:{basic:basic/100,bonus:bonus/100,gross:(basic+bonus)/100,deductions:total/100,net:(basic+bonus-total)/100},notes:[...new Set(['Unpaid live estimate. HQ must review and record payment separately.',...notes])]});
 }catch(error){return held(model,[...reasons,error.message||'Payroll records need HQ review.']);}
}
