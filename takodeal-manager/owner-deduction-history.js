import {isOwnerDeduction,OWNER_DEDUCTION_TYPE} from './owner-deduction-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function ownerDeductionHistoryRow(row){
 const at=row.dateAdded?.toDate?.()||new Date(row.dateAdded),date=Number.isFinite(+at)?at.toLocaleDateString('en-PH',{timeZone:'Asia/Manila'}):'Date not recorded';
 return '<tr data-owner-deduction-history="'+esc(row.id)+'" style="border-bottom:1px solid #e2e8f0"><td style="padding:12px 8px">'+esc(date)+'</td><td style="padding:12px 8px"><strong>'+esc(row.label||'One-time custom deduction')+'</strong><br><small>'+esc(row.category||'')+(row.effectiveDate?' · Payroll date: '+esc(row.effectiveDate):' · Awaiting review')+'</small></td><td style="padding:12px 8px">₱'+Number(row.amount||0).toFixed(2)+'</td><td style="padding:12px 8px">'+esc(row.status)+'</td><td style="padding:12px 8px"><button type="button" data-owner-deduction="'+esc(row.id)+'" style="min-height:44px;padding:8px 12px">Review one-time deduction</button></td></tr>';
}
export function installOwnerDeductionHistory(w,d){
 let generation=0;
 w.refreshEmployeeOneTimeDeductionRows=async staffId=>{
  const token=++generation,actor=w.auth?.currentUser?.uid,profileGeneration=w.staffProfileFormGeneration,body=d.getElementById('empProfileHistoryBody');
  const current=()=>token===generation&&body&&body.isConnected!==false&&w.auth?.currentUser?.uid===actor&&w.staffProfileFormGeneration===profileGeneration&&d.getElementById('empProfileId')?.value===staffId;
  if(!current())return false;
  const snap=await w.getDocsFromServer(w.query(w.collection(w.db,'staff_deductions'),w.where('staffId','==',staffId),w.where('type','==',OWNER_DEDUCTION_TYPE)));
  if(!current())return false;if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('The deduction was saved. Refresh history when connected.');
  const rows=snap.docs.map(doc=>({...doc.data(),id:doc.id})).filter(row=>row.staffId===staffId&&isOwnerDeduction(row));
  for(const node of body.querySelectorAll('[data-owner-deduction-history]'))node.remove();
  if(rows.length){if(!body.querySelector('button')&&/No deduction history|Loading/.test(body.textContent))body.replaceChildren();rows.sort((a,b)=>String(b.effectiveDate||'').localeCompare(String(a.effectiveDate||''))||a.id.localeCompare(b.id));body.insertAdjacentHTML('afterbegin',rows.map(ownerDeductionHistoryRow).join(''));}
  return true;
 };
 return w.refreshEmployeeOneTimeDeductionRows;
}
