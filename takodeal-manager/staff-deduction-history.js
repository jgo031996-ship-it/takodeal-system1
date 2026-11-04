// Presentation only. Existing protected review/payment handlers retain control
// of every action; formatting a history never changes a deduction or payroll.
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const layouts={profile:['Date','Type','Amount','Status','Action'],vale:['Date added','Type','Notes','Status','Amount']};
function addClass(node,value){if(!node)return;const classes=new Set(String(node.getAttribute?.('class')||node.className||'').split(/\s+/).filter(Boolean));classes.add(value);node.setAttribute('class',[...classes].join(' '));}
export function formatStaffDeductionHistory(tbody,{kind='profile'}={}){
 if(!tbody)return;const labels=layouts[kind]||layouts.profile,table=tbody.closest?.('table');
 addClass(table,'staff-deduction-history');table?.setAttribute('data-history-kind',kind==='vale'?'vale':'profile');table?.setAttribute('aria-label',kind==='vale'?'Deduction and Vale history':'Advances and deductions history');addClass(table?.parentElement,'staff-deduction-history-wrap');
 for(const row of tbody.querySelectorAll?.('tr')||[]){const cells=Array.from(row.children||[]).filter(cell=>cell.tagName==='TD');if(cells.length!==5)continue;addClass(row,'staff-deduction-history-row');cells.forEach((cell,index)=>{cell.setAttribute('data-label',labels[index]);addClass(cell,'staff-history-'+labels[index].toLowerCase().replaceAll(' ','-'));});}
}
function dateText(value){try{const date=value?.toDate?.()||new Date(value);return value&&Number.isFinite(+date)?date.toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'Date not recorded';}catch{return 'Date not recorded';}}
export function renderValeHistoryRows(records,{isPenaltyDeduction=()=>false,penaltyDateAction=()=>''}={}){
 return records.map(row=>{
  const type=String(row.type||'Deduction'),status=String(row.status||'Active'),amount=typeof row.amount==='number'?row.amount:typeof row.amount==='string'&&row.amount.trim()?Number(row.amount):NaN;
  const payment=type.includes('Payment')||type.includes('Auto-Deduct'),money=Number.isFinite(amount)?(payment?'+ ':'− ')+'₱'+amount.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}):'Amount needs review';
  const effective=isPenaltyDeduction(row)?'<small>Effective: '+escape(row.effectiveDate||'Original issue date')+'</small>'+(penaltyDateAction(row)||''):'';
  const cells=[escape(dateText(row.dateAdded))+effective,'<strong>'+escape(type)+'</strong>',escape(row.remarks||row.notes||'None'),'<span class="staff-history-status" data-status="'+(status==='Paid'?'paid':status==='Unpaid'?'unpaid':'review')+'">'+escape(status)+'</span>','<strong class="staff-history-money" data-payment="'+payment+'">'+escape(money)+'</strong>'];
  return '<tr class="staff-deduction-history-row">'+cells.map((html,index)=>'<td class="staff-history-'+layouts.vale[index].toLowerCase().replaceAll(' ','-')+'" data-label="'+layouts.vale[index]+'">'+html+'</td>').join('')+'</tr>';
 }).join('');
}
