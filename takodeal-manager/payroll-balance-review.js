import {classifyPayrollRosterEntry} from './payroll-roster-model.js';
const money=value=>'₱'+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const text=value=>String(value??'').trim();
function dateLabel(value){try{const date=value?.toDate?.()??(value?.seconds!=null?new Date(value.seconds*1000):new Date(value));return Number.isFinite(+date)?date.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'}):'Date not recorded';}catch{return 'Date not recorded';}}

export function buildPayrollRosterReview({staffData,paidRecords,staffDict,resolver,sources=new Map(),unmatched=[],identities=new Map()}){
 const names=[],reviewRows=[...unmatched],holds=[];
 for(const name of new Set([...Object.keys(staffData),...Object.keys(paidRecords)])){
  const identity=identities.get(name)||resolver(name),entry=classifyPayrollRosterEntry({name,profile:staffDict[name],data:staffData[name],isPaid:Boolean(paidRecords[name]),identity});
  if(entry.section==='review')reviewRows.push({...entry,records:sources.get(name)||[]});
  else{names.push(name);if(entry.holdPayment)holds.push({name,reason:entry.reason});}
 }
 return {names,reviewRows,holds};
}

// This panel only presents records already read for the authorized cutoff.
// No profile, deduction, payment, or employee identity is changed here.
export function renderPayrollBalanceReview(document,rows=[]){
 const root=document.getElementById('payrollBalanceReview');if(!root)return;
 root.replaceChildren();root.hidden=!rows.length;if(!rows.length)return;
 const el=(tag,className,content)=>{const node=document.createElement(tag);if(className)node.className=className;if(content!==undefined)node.textContent=content;return node;};
 const details=el('details','payroll-balance-review'),summary=el('summary','','Former staff & unmatched balances · '+rows.length+' record group(s)');
 details.append(summary,el('p','payroll-balance-intro','These saved balances are kept for review and are excluded from this payroll list. They have not been deleted, forgiven, reassigned or collected.'));
 const list=el('div','payroll-balance-list');
 for(const row of rows){
  const article=el('article','payroll-balance-item'),head=el('div','payroll-balance-heading');
  head.append(el('strong','',text(row.name)||'Employee identity needs review'),el('span','',text(row.branch)&&row.branch!=='Unknown'?row.branch:'Branch not confirmed'));article.append(head,el('p','payroll-balance-reason',row.reason||'Confirm this employee’s saved profile before arranging payroll.'));
  const records=Array.isArray(row.records)?row.records:[];
  if(records.length){const entries=el('ul','payroll-balance-records');for(const record of records){const item=el('li',''),copy=el('span','',''+(text(record.type)||'Saved balance')+' · '+dateLabel(record.dateAdded??record.timestamp));item.append(copy,el('strong','',record.amountNeedsReview?'Amount needs review':record.amount==null?'Attendance record':money(record.amount)));if(record.remarks)item.append(el('small','',String(record.remarks)));if(record.id)item.append(el('small','','Reference: '+record.id));entries.append(item);}article.append(entries);}
  else article.append(el('p','','No current-cutoff attendance was found for this saved balance. Review its source in Staff & Security or Loans & Ledger.'));
  list.append(article);
 }
 details.append(list);root.append(details);
}
