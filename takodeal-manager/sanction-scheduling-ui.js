import {phDay, isPenaltyDeduction} from './sanction-schedule.js';
import {sanctionAuthority, rescheduleSanction, reschedulePenalty} from './sanction-actions.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateValue=value=>{const date=value?.toDate?.() || new Date(value?.seconds!=null?value.seconds*1000:value);return Number.isFinite(+date)?date:null;};
export const issueDateText=row=>{const date=dateValue(row.issuedAt || row.timestamp || row.dateAdded);return date?date.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric'}):'Original date on record';};
const auditHtml=row=>Object.values(row.scheduleAudit || {}).sort((a,b)=>(+dateValue(a.at)||0)-(+dateValue(b.at)||0)).map(entry=>'<li>'+esc(entry.oldDate || 'Immediate / original issue date')+' → '+esc(entry.newDate)+' · '+esc(entry.reason)+'<br><small>'+esc(entry.actorEmail || entry.actorUid)+' · '+esc(dateValue(entry.at)?.toLocaleString('en-PH',{timeZone:'Asia/Manila'}) || 'Timestamp not available')+'</small></li>').join('');
export function installSanctionScheduling(api,document) {
    if(api.sanctionSchedulingInstalled)return;api.sanctionSchedulingInstalled=true;
    const read=api.getDocFromServer||api.getDoc;
    async function edit(id,collection) {
        try {
            sanctionAuthority(api,null,{money:collection==='staff_deductions'});
            const snap=await read(api.doc(api.db,collection,id));if(!snap.exists())throw Error('This record no longer exists.');let row=snap.data();
            if(collection==='staff_deductions'&&row.sanctionId){const notice=await read(api.doc(api.db,'hr_sanctions',row.sanctionId));if(!notice.exists())throw Error('The linked notice is missing.');if(!['Archived','Resolved','Closed','Cancelled','Canceled','Deleted'].includes(notice.data().status))return edit(row.sanctionId,'hr_sanctions');}
            sanctionAuthority(api,row.branch,{money:collection==='staff_deductions'||!!row.deductionId});
            const frozen=collection==='staff_deductions'&&(row.status!=='Unpaid'||row.paidAt||row.payrollRecordId||row.frozenPayrollId||row.payrollSettlementId||row.payrollFrozen) || collection==='hr_sanctions'&&['Archived','Resolved','Closed','Cancelled','Canceled','Deleted'].includes(row.status);
            const changeId='change-'+crypto.randomUUID();
            const result=await api.Swal.fire({titleText:row.staffName+' · Effective date',html:'<p style="text-align:left;font-size:13px">Issued: '+esc(issueDateText(row))+'<br>Current effective date: <strong>'+esc(row.effectiveDate || 'Immediate / original issue date')+'</strong></p>'+(frozen?'<p>'+(collection==='hr_sanctions'?'Finished notices are read-only. An unpaid linked penalty can be reviewed separately in the ledger.':'Paid or frozen payroll dates cannot be changed.')+'</p>':'<label style="display:block;text-align:left">New effective date (PH)<input id="sanctionNewDate" type="date" min="'+phDay()+'" value="'+esc(row.effectiveDate && row.effectiveDate>=phDay()?row.effectiveDate:phDay())+'" class="swal2-input" style="display:block;width:90%;margin:8px 0"></label><label style="display:block;text-align:left">Reason for changing the date<textarea id="sanctionDateReason" class="swal2-textarea" placeholder="For example: postponed because the branch is short of staff" style="width:90%;margin:8px 0"></textarea></label>')+'<details style="text-align:left"><summary>Date change history</summary><ul style="font-size:12px;line-height:1.7">'+(auditHtml(row)||'<li>No date changes on record.</li>')+'</ul></details>',showCancelButton:!frozen,confirmButtonText:frozen?'Close':'Save effective date',cancelButtonText:'Cancel',preConfirm:async()=>{
                if(frozen)return true;try {const input={effectiveDate:document.getElementById('sanctionNewDate').value,reason:document.getElementById('sanctionDateReason').value,expectedRevision:Number(row.scheduleRevision)||0,changeId};if(collection==='hr_sanctions')await rescheduleSanction(api,id,input);else await reschedulePenalty(api,id,input);return true;}catch(error){api.Swal.showValidationMessage(error.message);return false;}
            }});
            if(result.isConfirmed&&!frozen){await api.loadSanctionsDashboard?.();api.loadLedger?.();api.generateAutoPayslips?.();api.ManagerUI?.notify?.('Effective date saved. The original issue date remains on record.');}
        }catch(error){api.Swal.fire('Could not change date',error.message,'error');}
    }
    api.editSanctionEffectiveDate=id=>edit(id,'hr_sanctions');
    api.editPenaltyEffectiveDate=id=>edit(id,'staff_deductions');
    api.penaltyDateAction=row=>isPenaltyDeduction(row)&&row.status==='Unpaid'?'<button type="button" class="action-btn" data-penalty-date="'+esc(row.id)+'">Change effective date</button>':'';
    document.addEventListener('click',event=>{const penalty=event.target.closest?.('[data-penalty-date]')?.dataset.penaltyDate,notice=event.target.closest?.('[data-sanction-date]')?.dataset.sanctionDate;if(penalty)api.editPenaltyEffectiveDate(penalty);if(notice)api.editSanctionEffectiveDate(notice);});
}
