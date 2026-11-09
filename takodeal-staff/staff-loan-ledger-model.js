const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const text=(value,max=200)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const own=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const invalid=()=>Object.assign(Error('Your saved loan records need an HQ review. No balance has been estimated.'),{code:'loan-ledger-review'});
export function loanLedgerCents(value){
 if(typeof value==='string'){if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value))throw invalid();value=Number(value);}
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw invalid();
 const cents=Math.round(value*100);if(!Number.isSafeInteger(cents)||cents>100000000000||Math.abs(value*100-cents)>0.00001)throw invalid();return cents;
}
function date(value){
 if(value==null)return null;
 try{const parsed=value instanceof Date?value:typeof value?.toDate==='function'?value.toDate():new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString():null;}catch{return null;}
}
function sourceLedger(row,staffId){
 if(!object(row)||!id(row.id)||row.staffId!=null&&row.staffId!==staffId)throw invalid();
 const loaned=loanLedgerCents(row.totalLoaned),paid=loanLedgerCents(row.totalPaid),cutoff=row.cutoffDeduction==null?null:loanLedgerCents(row.cutoffDeduction);
 return{id:row.id,totalLoaned:loaned/100,totalPaid:paid/100,remainingBalance:(loaned-paid)/100,cutoffDeduction:cutoff==null?null:cutoff/100};
}
function sourceHistory(row,staffId){
 if(!object(row)||!id(row.id)||row.staffId!=null&&row.staffId!==staffId)throw invalid();
 const type=row.type==='Company Loan Issued'?'issued':row.type==='Company Loan Payment'?'payment':null;if(!type)throw invalid();
 if(type==='payment'&&row.status!=='Paid')throw invalid();
 if(row.remarks!=null&&(typeof row.remarks!=='string'||row.remarks.length>2000)||row.payrollRecordId!=null&&!id(row.payrollRecordId))throw invalid();
 return{id:row.id,type,amount:loanLedgerCents(row.amount)/100,recordedAt:date(row.paidAt??row.dateAdded),remarks:row.remarks||'',payrollRecordId:row.payrollRecordId??null};
}
// The server must first prove every source row belongs to this exact employee.
// This projection never mutates a ledger or reconstructs its balance from logs.
export function buildStaffLoanLedgerSnapshot({staffId,staffName,branch,asOf,ledgers=[],history=[],historyComplete=true,reviewRequired=false}={}){
 if(!id(staffId)||!text(staffName)||!text(branch)||!date(asOf)||!Array.isArray(ledgers)||!Array.isArray(history)||typeof historyComplete!=='boolean'||typeof reviewRequired!=='boolean')throw invalid();
 let ledger=null,rows=[];
 if(ledgers.length>1)reviewRequired=true;
 else if(ledgers.length===1){try{ledger=sourceLedger(ledgers[0],staffId);}catch{reviewRequired=true;}}
 const relevant=history.filter(row=>row?.type==='Company Loan Issued'||row?.type==='Company Loan Payment');
 if(relevant.length>200){historyComplete=false;reviewRequired=true;}
 else try{rows=relevant.map(row=>sourceHistory(row,staffId));if(new Set(rows.map(row=>row.id)).size!==rows.length)throw invalid();}catch{rows=[];historyComplete=false;reviewRequired=true;}
 rows.sort((a,b)=>(b.recordedAt||'').localeCompare(a.recordedAt||'')||a.id.localeCompare(b.id));
 if(!ledger&&relevant.length)reviewRequired=true;
 return{schemaVersion:1,currency:'PHP',staffId,staffName,branch,asOf:date(asOf),ledger,history:rows,historyComplete,agreementStatus:'not-recorded',reviewRequired};
}
export function normalizeStaffLoanLedger(value,{staffId}={}){
 const keys=['schemaVersion','currency','staffId','staffName','branch','asOf','ledger','history','historyComplete','agreementStatus','reviewRequired'];
 if(!own(value,keys)||value.schemaVersion!==1||value.currency!=='PHP'||!id(staffId)||value.staffId!==staffId||!text(value.staffName)||!text(value.branch)||date(value.asOf)!==value.asOf||!Array.isArray(value.history)||value.history.length>200||typeof value.historyComplete!=='boolean'||typeof value.reviewRequired!=='boolean'||value.agreementStatus!=='not-recorded')throw invalid();
 let ledger=null;
 if(value.ledger!==null){
  const row=value.ledger;if(!own(row,['id','totalLoaned','totalPaid','remainingBalance','cutoffDeduction']))throw invalid();
  ledger=sourceLedger(row,staffId);if(typeof row.remainingBalance!=='number'||row.remainingBalance!==ledger.remainingBalance)throw invalid();
 }
 const history=value.history.map(row=>{
  if(!own(row,['id','type','amount','recordedAt','remarks','payrollRecordId'])||!id(row.id)||!['issued','payment'].includes(row.type)||typeof row.remarks!=='string'||row.remarks.length>2000||row.recordedAt!==null&&date(row.recordedAt)!==row.recordedAt||row.payrollRecordId!==null&&!id(row.payrollRecordId))throw invalid();
  return{...row,amount:loanLedgerCents(row.amount)/100};
 });
 if(new Set(history.map(row=>row.id)).size!==history.length||!ledger&&history.length&&!value.reviewRequired)throw invalid();
 return{...value,ledger,history};
}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'₱'+value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const shownDate=value=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Date not recorded';
export function staffLoanLedgerHTML(snapshot){
 const data=normalizeStaffLoanLedger(snapshot,{staffId:snapshot?.staffId}),ledger=data.ledger;
 const summary=data.reviewRequired?'<p class="loan-notice" role="status">HQ needs to review these saved records. Your balance is unavailable; no amount has been estimated.</p>':ledger?`<section class="loan-summary"><span>${ledger.remainingBalance<0?'Recorded credit balance':'Remaining company loan balance'}</span><strong>${escape(money(Math.abs(ledger.remainingBalance)))}</strong><dl><div><dt>Total loaned</dt><dd>${escape(money(ledger.totalLoaned))}</dd></div><div><dt>Total paid</dt><dd>${escape(money(ledger.totalPaid))}</dd></div></dl></section>`:'<p class="loan-notice">No company loan ledger is recorded for your staff account.</p>';
 const terms=ledger&&!data.reviewRequired?`<p>Recorded deduction per cutoff: <strong>${ledger.cutoffDeduction===null?'Not recorded':escape(money(ledger.cutoffDeduction))}</strong>.</p>`:'';
 const history=data.history.map(row=>`<li class="loan-history-row"><div><strong>${row.type==='issued'?'Loan issued':'Loan payment'}</strong><span>${escape(shownDate(row.recordedAt))}</span>${row.remarks?`<p>${escape(row.remarks)}</p>`:''}${row.payrollRecordId?'<small>Linked to a saved payroll record</small>':''}</div><strong>${escape(money(row.amount))}</strong></li>`).join('');
 return`<div class="staff-loan-ledger"><p class="loan-account">${escape(data.staffName)} · ${escape(data.branch)}</p>${summary}<section class="loan-terms"><h3>Repayment details</h3>${terms}<p>No separate loan agreement is recorded in this system. Ask HQ for your signed agreement or to confirm the terms.</p><p class="loan-muted">An unpaid payslip deduction has not been collected. Saved payroll deductions are shown as history only and are not deducted again from this balance.</p></section><section><h3>Issuance and payment history</h3>${!data.historyComplete?'<p class="loan-notice">This history is incomplete. Ask HQ to review the complete records.</p>':''}${history?`<ul class="loan-history">${history}</ul>`:'<p class="loan-muted">No loan history is available in this view.</p>'}</section><p class="loan-muted">Checked ${escape(shownDate(data.asOf))}. Read only; this view does not change your loan or payroll.</p></div>`;
}
