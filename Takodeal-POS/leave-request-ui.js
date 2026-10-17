import {createStaffLeaveService} from './leave-request-actions.js';
import {activeLeaveDates,leaveToday,describeLeaveDates} from './leave-model.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function installPOSLeaveRequests(w,d,{primaryAuth}={}) {
    let resolved=null,epoch=0,submitting=false;const attempts=new Map(),activeActions=new Set();
    const current=()=>w.sessionUser;
    const key=()=>JSON.stringify([primaryAuth?.currentUser?.uid,current()?.staffId,current()?.cashierName,current()?.branch]);
    const service=createStaffLeaveService(w,{getIdentity:()=>({staffId:current()?.staffId||resolved?.key===key()&&resolved.staffId,staffName:current()?.cashierName})});
    async function identity(){const before=key(),session=current();if(!session?.cashierName)throw Error('Sign in to your staff account before requesting leave.');
        if(w.confirmPOSStaffSession){await w.confirmPOSStaffSession();if(before!==key())throw Error('Your staff account changed. Reopen your requests.');}
        if(!session.staffId){const snap=await w.getDocsFromServer(w.query(w.collection(w.db,'cashiers'),w.where('cashierName','==',session.cashierName)));if(before!==key()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||snap.docs.length!==1)throw Error('Your staff account could not be confirmed. Sign in again.');resolved={key:before,staffId:snap.docs[0].id};}
        return before;
    }
    async function pin(){const result=await w.Swal.fire({titleText:'Confirm your leave request',text:'Enter your staff login PIN in the app.',input:'password',inputAttributes:{autocomplete:'off'},showCancelButton:true,confirmButtonText:'Confirm'});return result.isConfirmed?String(result.value||''):null;}
    async function submit(){const before=await identity(),input={startDate:d.getElementById('reqLeaveStart').value,endDate:d.getElementById('reqLeaveEnd').value,leaveType:d.getElementById('reqLeaveType').value,reason:d.getElementById('reqLeaveReason').value.trim()},intent=JSON.stringify([before,input]);
        const entered=await pin();if(entered===null)return;if(before!==key())throw Error('Your staff account changed. Reopen the request.');
        if(!attempts.has(intent))attempts.set(intent,w.crypto.randomUUID());await service.submit({...input,pin:entered,id:attempts.get(intent)});attempts.delete(intent);
        for(const id of ['reqLeaveStart','reqLeaveEnd','reqLeaveReason'])d.getElementById(id).value='';
        await w.Swal.fire('Leave request submitted','Management will review the requested dates.','success');return true;
    }
    async function action(request,kind){if(activeActions.has(request.id))return;activeActions.add(request.id);try{const before=await identity();let changes={};
        if(kind!=='Withdraw'){
            const result=await w.Swal.fire({titleText:kind==='Cancel'?'Request leave cancellation':'Request different leave dates',html:(kind==='Dates'?'<label>New start date<input type="date" id="posLeaveChangeStart"></label><label>New end date<input type="date" id="posLeaveChangeEnd"></label>':'<p>Only remaining leave dates can be cancelled. Management must approve this change.</p>')+'<label>Reason<textarea id="posLeaveChangeReason" rows="3"></textarea></label>',showCancelButton:true,confirmButtonText:'Continue',preConfirm:()=>({reason:d.getElementById('posLeaveChangeReason').value,...(kind==='Dates'?{startDate:d.getElementById('posLeaveChangeStart').value,endDate:d.getElementById('posLeaveChangeEnd').value}:{})})});
            if(!result.isConfirmed)return;changes=result.value;
        }
        const entered=await pin();if(entered===null)return;if(before!==key())throw Error('Your staff account changed. Reopen your requests.');
        if(kind==='Withdraw')await service.withdraw({requestId:request.id,pin:entered});
        else {const intent=JSON.stringify([before,request.id,kind,changes]);if(!attempts.has(intent))attempts.set(intent,w.crypto.randomUUID());await service.requestChange({id:attempts.get(intent),requestId:request.id,kind,...changes,pin:entered});attempts.delete(intent);}
        await w.Swal.fire('Request updated',kind==='Withdraw'?'Your pending request was withdrawn.':'Management will review this change. Approved leave stays in place until then.','success');await w.loadStaffPersonalInbox();
    }catch(error){w.Swal.fire('Leave request',error.message,'info');}finally{activeActions.delete(request.id);}}
    async function render(container){const generation=++epoch,before=await identity(),rows=await service.list();if(generation!==epoch||before!==key())return;
        const existing=d.getElementById('posLeaveHistory');existing?.remove();const section=d.createElement('section');section.id='posLeaveHistory';section.className='pos-leave-history';
        const heading=d.createElement('h3');heading.textContent='Leave requests and changes';section.append(heading);
        rows.sort((a,b)=>String(b.timestamp?.toDate?.()?.toISOString?.()||b.timestamp||'').localeCompare(String(a.timestamp?.toDate?.()?.toISOString?.()||a.timestamp||'')));
        for(const row of rows){const card=d.createElement('article');card.className='pos-leave-card';const dates=row.type==='Leave'?activeLeaveDates(row):row.requestedActiveDates||[];
            card.innerHTML='<header><strong>'+escape(row.type==='Leave Change'?(row.changeKind==='Cancel'?'Cancellation request':'Date change request'):row.leaveType||'Leave')+'</strong><span>'+escape(row.status==='Pending'?'Pending management review':row.leaveState||row.status||'Pending')+'</span></header><p>'+escape(describeLeaveDates(dates)||row.startDate+' → '+row.endDate)+'</p><p>'+escape(row.reason)+'</p>'+(row.managerReply?'<p>Management: '+escape(row.managerReply)+'</p>':'');
            const actions=d.createElement('div');actions.className='pos-settings-actions';
            const choices=row.status==='Pending'?[['Withdraw pending request','Withdraw']]:row.type==='Leave'&&row.status==='Approved'&&!row.pendingLeaveChangeId&&dates.some(date=>date>=leaveToday())?[['Request cancellation','Cancel'],['Request date change','Dates']]:[];
            for(const [label,kind] of choices){const button=d.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>action(row,kind);actions.append(button);}card.append(actions);section.append(card);
        }
        if(!rows.length){const empty=d.createElement('p');empty.textContent='No leave requests found for your staff account.';section.append(empty);}container.append(section);
    }
    const originalSubmit=w.submitStaffRequest;
    w.submitStaffRequest=async function(type){if(type!=='Leave')return originalSubmit.apply(this,arguments);if(submitting)return false;submitting=true;try{return await submit();}catch(error){w.Swal.fire('Leave request',error.message,'info');return false;}finally{submitting=false;}};
    const originalInbox=w.loadStaffPersonalInbox;
    w.loadStaffPersonalInbox=async function(){const before=key();await originalInbox();if(before!==key())return;const container=d.getElementById('staffPersonalInboxList');
        for(const card of [...container.children])if(['Leave','Leave Change'].includes(card.querySelector('strong')?.textContent))card.remove();
        try{await render(container);}catch(error){const warning=d.createElement('p');warning.setAttribute('role','status');warning.textContent=error.message;container.append(warning);}};
    return {service,submit,render};
}
