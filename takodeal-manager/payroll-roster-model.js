// Preview classification only. Source balances, punches and paid payslips are
// retained; this module never changes an amount or an employee's saved record.
import {staffLifecycleState} from './staff-lifecycle-model.js';
const text=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
const nameKey=value=>text(value).normalize('NFKC').toLocaleLowerCase('en');
const nameOf=profile=>text(profile?.cashierName)||text(profile?.fullName)||text(profile?.name);
const idOf=profile=>text(profile?.staffId)||text(profile?.id);
const aliasesOf=profile=>[profile?.cashierName,profile?.fullName,profile?.name,profile?.scheduleNickname,profile?.nickname].map(nameKey).filter(Boolean);
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;

export function payrollProfileState(profile){
 return staffLifecycleState(profile);
}

// An explicit staff ID always wins over a legacy name, but a missing or
// conflicting ID never falls back to a different person's matching name.
// Only aliases actually saved on a profile are recognized; no typo guessing.
export function createPayrollRosterResolver(profiles=[]){
 const list=Array.isArray(profiles)?profiles:profiles instanceof Map?[...profiles.values()]:Object.values(profiles||{});
 const byId=new Map(),byName=new Map();
 const add=(map,key,profile)=>{if(!key)return;const rows=map.get(key)||[];if(!rows.includes(profile))rows.push(profile);map.set(key,rows);};
 for(const profile of list){if(!profile||typeof profile!=='object')continue;add(byId,idOf(profile),profile);for(const key of new Set(aliasesOf(profile)))add(byName,key,profile);}
 return function resolve(record){
  const row=typeof record==='string'?{staffName:record}:record||{},rawName=text(row.staffName)||text(row.name)||text(row.frozenData?.name);
  const rawIds=[row.staffId,row.frozenData?.staffId,row.frozenData?.profile?.staffId,row.frozenData?.profile?.id,row.profile?.staffId,row.profile?.id].filter(value=>value!==undefined&&value!==null&&value!=='');
  const ids=[...new Set(rawIds.map(text))],fallback={name:rawName,staffId:ids.length===1?ids[0]:'',branch:text(row.branch)||text(row.frozenData?.branch),profile:null,matchedBy:''};
  const result=(status,reason,extra={})=>({...fallback,status,reason,...extra});
  if(rawIds.some(value=>typeof value!=='string'||!text(value)||text(value).includes('/'))||ids.length>1)return result('conflict','The source record contains conflicting employee IDs.');
  const named=byName.get(nameKey(rawName))||[];
  let candidates,matchedBy;
  if(ids.length){candidates=byId.get(ids[0])||[];matchedBy='staff-id';if(!candidates.length)return result('missing','The source employee ID no longer has a saved staff profile.');}
  else {candidates=named;matchedBy='saved-name';if(!rawName)return result('missing','The source employee name is missing.');if(!candidates.length)return result('missing','No saved employee matches this exact name or saved alias.');}
  if(candidates.length!==1)return result('ambiguous','More than one saved employee matches this identity.');
  const profile=candidates[0],staffId=idOf(profile),name=nameOf(profile),branch=text(profile.branch);
  if(!staffId||!name)return result('conflict','The saved employee is missing a stable ID or name.');
  if(ids.length&&named.length&&!named.includes(profile))return result('conflict','The source employee ID and saved name identify different people.');
  if(!ids.length&&fallback.branch&&branch&&fallback.branch!==branch)return result('conflict','A name-only record has a different branch. Confirm the employee before applying it.');
  const nameCollision=(byName.get(nameKey(name))||[]).length>1;
  return result('matched',nameCollision?'Multiple saved employee profiles share this name. Confirm their IDs before combining payroll.':'',{
   name,staffId,branch,profile,matchedBy,nameCollision,
   nameChanged:Boolean(rawName&&!aliasesOf(profile).includes(nameKey(rawName)))
  });
 };
}

function cutoffActivity(data={}){
 if(['totalHours','hours','shiftsWorked','basicPay','nightBonusTotal','nightBonus','perfBonusTotal','perfBonus','holidayPayTotal','straightDutyBonusTotal','straightBonus'].some(key=>positive(data[key])))return true;
 if(data.attendanceReviewRequired===true||(Array.isArray(data.attendanceLogIds)&&data.attendanceLogIds.length))return true;
 return Array.isArray(data.logs)&&data.logs.some(row=>{
  if(row?.needsAttendanceReview===true||(Array.isArray(row?.attendanceLogIds)&&row.attendanceLogIds.length))return true;
  if(positive(Number(row?.hrs)))return true;
  const incoming=text(row?.in),outgoing=text(row?.out);
  return /\d:\d/.test(incoming)&&(/\d:\d/.test(outgoing)||outgoing.toUpperCase()==='MISSED');
 });
}

// `data` must be the existing selected-cutoff aggregate, not an all-time row.
// Real work/earned adjustments and paid history must not disappear simply
// because the employee was offboarded after the work was performed.
export function classifyPayrollRosterEntry({name='',profile=null,data={},isPaid=false,identity=null,hasCutoffActivity}={}){
 const resolved=identity?.status==='matched'?identity.profile:null,person=resolved||profile;
 const state=payrollProfileState(person),work=typeof hasCutoffActivity==='boolean'?hasCutoffActivity:cutoffActivity(data);
 const display={name:identity?.name||text(name)||text(data.name)||nameOf(person),staffId:identity?.staffId||idOf(person)||text(data.staffId),branch:identity?.branch||text(person?.branch)||text(data.branch)||'Not recorded',active:state.active};
 const entry=(section,category,reason,holdPayment=false)=>({...display,section,category,reason,holdPayment,hasCutoffActivity:work});
 if(isPaid||data.isPaid===true)return entry('payroll','paid','The saved paid payslip is retained unchanged.');
 const badIdentity=identity&&(identity.status!=='matched'||identity.nameCollision===true);
 if(badIdentity||!person||!idOf(person)||!nameOf(person)){
  const reason=identity?.reason||'The employee identity must be confirmed from the saved staff directory.';
  return work?entry('payroll','identity-review',reason,true):entry('review','unmatched-balance',reason,true);
 }
 if(state.active)return entry('payroll','current','Current employee. Existing unpaid balances remain in this cutoff.');
 if(work)return entry('payroll','former-cutoff-work','Former employee with selected-cutoff work, an earned adjustment or attendance requiring review.');
 return entry('review','former-balance','Former or inactive employee with no selected-cutoff work. The unpaid balance remains available for separate review.',true);
}

function ledgerAmount(value,fallback=0){
 if(value===undefined||value===null)return fallback;
 if(!['number','string'].includes(typeof value)||typeof value==='string'&&(!value.trim()||!/^\+?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())))return null;
 const number=Number(value);return Number.isFinite(number)&&number>=0&&number<=Number.MAX_SAFE_INTEGER/100?number:null;
}

// Existing loan settlements match the saved staffName literally. A stable-ID
// rename, saved nickname or transferred branch therefore needs review instead
// of silently moving an old loan to a new settlement identity.
export function buildPayrollLedgerReview(records,resolver){
 if(!Array.isArray(records)||typeof resolver!=='function')throw TypeError('Confirmed loan records and an employee resolver are required.');
 const ledgerDict=Object.create(null),reviewRows=[],reasons=new Map(),candidates=new Map();
 const hold=(name,reason)=>{if(!name)return;const list=reasons.get(name)||new Set();list.add(reason);reasons.set(name,list);};
 const review=(row,identity,reason,amount,{reviewIfNoCutoffWork=false}={})=>{
  const entry={name:identity?.name||text(row.staffName)||'Employee identity needs review',staffId:identity?.staffId||text(row.staffId),branch:identity?.branch||text(row.branch)||'Not recorded',category:'loan-balance',reason,reviewIfNoCutoffWork,
   sourceRecords:[row],records:[{...row,type:row.type||'Loan ledger balance',amount,amountNeedsReview:amount===null}]};
  reviewRows.push(entry);return entry;
 };
 for(const raw of records){
  const row=raw&&typeof raw==='object'?raw:{},identity=resolver(row),loaned=ledgerAmount(row.totalLoaned),paid=ledgerAmount(row.totalPaid),rate=ledgerAmount(row.cutoffDeduction);
  const amount=loaned===null||paid===null?null:loaned-paid;
  if(amount!==null&&amount<=0)continue;
  let reason='';
  if(amount===null||rate===null)reason='The saved loan amount or cutoff deduction needs review before payroll.';
  else if(identity.status!=='matched'||identity.nameCollision)reason=identity.reason||'The loan employee identity needs review.';
  else if(typeof row.id!=='string'||!row.id.trim()||row.id.includes('/'))reason='The saved loan record is missing its source reference.';
  else if(row.staffName!==identity.name)reason='This loan uses a different saved employee name. Confirm the original loan before applying it to this payslip.';
  else if(text(row.branch)&&text(row.branch)!==identity.branch)reason='This loan has a different saved branch. Confirm its employee and branch before applying it.';
  if(reason){review(row,identity,reason,amount);hold(identity.name||text(row.staffName),reason);continue;}
  const rows=candidates.get(identity.name)||[];rows.push({row,identity,amount});candidates.set(identity.name,rows);
 }
 for(const [name,rows]of candidates){
  if(rows.length>1){
   const reason='More than one positive loan ledger is saved for this employee. Review the originals before choosing a cutoff deduction.';
   hold(name,reason);for(const {row,identity,amount}of rows)review(row,identity,reason,amount);continue;
  }
  const {row,identity,amount}=rows[0];
  if(reasons.has(name)){review(row,identity,'Another loan source for this employee needs identity or amount review before payroll.',amount);continue;}
  ledgerDict[name]=row;
  if(!payrollProfileState(identity.profile).active)review(row,identity,'Former or inactive employee with an outstanding loan. Keep this balance for review when no selected-cutoff work is payable.',amount,{reviewIfNoCutoffWork:true});
 }
 return {ledgerDict,reviewRows,holds:[...reasons].map(([name,list])=>({name,reason:[...list].join(' ')}))};
}
