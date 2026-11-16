import {canResolveInboxShift,prepareInboxShift} from './owner-request-actions.js';
import {acknowledgeScheduleDeclaration} from './attendance-swap-declaration.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const time=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

export function installOwnerRequestDialog(api,d){
    let active=null;
    function canOpen(request){
        return canResolveInboxShift(api,request.branch);
    }
    async function open({request,attendance,profileId,fingerprint,referenceError,manual,assertCurrent=()=>{}}){
        if(active?.busy)throw Error('Wait for the current request to finish saving.');
        active?.node.close();
        const declaration=request.type==='Schedule Declaration',p=declaration?request.scheduleDeclaration:request.staffShiftProposal;
        const shift=declaration?p.targetShiftName:p.shiftName,begin=declaration?p.targetStartAt:p.expectedStartAt,end=declaration?p.targetEndAt:p.expectedEndAt;
        const user=api.auth.currentUser,session=api.sessionUser,node=d.createElement('dialog'),state={node,busy:false};
        active=state;
        const current=()=>{
            assertCurrent();
            if(active!==state||!node.open||api.auth.currentUser!==user||api.sessionUser!==session||!canOpen(request))
                throw Error('Reopen this request with the current Owner account.');
        };
        node.setAttribute('class','owner-request-dialog');
        node.setAttribute('aria-labelledby','ownerRequestTitle');node.setAttribute('data-request-kind',declaration?'schedule':'lateness');
        node.innerHTML='<header><p>'+escape(request.type)+'</p><h2 id="ownerRequestTitle">'+(declaration?'Confirm worked shift':'Review late arrival')+'</h2></header>'
            +'<section><p><strong>'+escape(request.staffName)+'</strong> · '+escape(request.branch)+'</p><p><strong>'+escape(shift)+'</strong><br>'+escape(time(begin))+' → '+escape(time(end))+' (PH)</p>'
            +'<p>'+(declaration?'Confirm the shift for this employee and mark the statement reviewed. The coworker keeps their plotted shift.':'Approve the letter and waive its late deduction for this clock-in.')+'</p>'
            +'<details><summary>Employee explanation</summary><p>'+escape(declaration?p.explanation:request.explanationMessage||'No explanation recorded.')+'</p></details>'
            +(declaration?'':'<label for="inboxShiftReply">Reply (optional)</label><textarea id="inboxShiftReply" maxlength="1500" rows="2"></textarea>')
            +'<p data-notes></p><p role="status" aria-live="polite" data-status>Checking the saved roster and attendance…</p></section>'
            +'<footer><button type="button" data-save disabled></button><button type="button" data-alt></button><button type="button" data-close>Close</button></footer>';
        d.body.append(node);node.showModal();
        const find=key=>node.querySelector('[data-'+key+']'),save=find('save'),alt=find('alt'),close=find('close'),status=find('status'),notes=find('notes');
        let review=null,blocked=false;
        const saveLabel=declaration?'Confirm shift & mark reviewed':'Confirm shift & approve';
        save.textContent=saveLabel;
        alt.textContent=declaration?'Mark reviewed only':'Keep original shift…';
        const release=()=>{if(active===state)active=null;node.remove();};
        node.addEventListener('close',release);
        node.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();});
        close.onclick=()=>{if(!state.busy)node.close();};
        function openAttendance(){
            current();
            if(typeof api.openAttendanceRecovery!=='function')throw Error('Attendance is still loading. Reopen the Inbox and try again.');
            const args={staffId:request.staffId,staffName:request.staffName,branch:request.branch,attendanceLogId:attendance.id,from:p.workDate,to:p.workDate};
            node.close();return api.openAttendanceRecovery(args);
        }
        async function act(ackOnly){
            if(state.busy||!node.open)return;
            let saved=false;
            try{
                current();
                if(!ackOnly&&blocked)return await openAttendance();
                if(ackOnly&&!declaration){node.close();return await manual();}
                if(!ackOnly&&!review)return;
                state.busy=true;close.disabled=alt.disabled=save.disabled=true;
                status.textContent='Saving the decision…';
                if(ackOnly)await acknowledgeScheduleDeclaration(api,{requestId:request.id,attendanceId:attendance.id,branch:request.branch,expectedFingerprint:fingerprint});
                else await review.save(d.getElementById('inboxShiftReply')?.value.trim()||'');
                saved=true;current();node.close();
                api.invalidateCache?.('global_schedule');api.invalidateCache?.('attendance_logs');
                api.ManagerUI?.notify?.(ackOnly?'Statement marked reviewed.':declaration?'Worked shift confirmed. Statement reviewed.':'Worked shift confirmed. Letter approved and late deduction waived.');
                if(api.ownerInbox?.applyConfirmedRequest)await api.ownerInbox.applyConfirmedRequest(request.id);
                else await api.loadInbox?.();
            }catch(error){
                if(active===state&&node.open)status.textContent=error.message||'Reopen the request and check its saved status.';
                else if(saved)api.ManagerUI?.notify?.('Decision saved. Refresh the Inbox to see it.');
            }finally{
                state.busy=false;
                if(active===state&&node.open){close.disabled=alt.disabled=false;save.disabled=!review&&!blocked;}
            }
        }
        save.onclick=()=>act(false);alt.onclick=()=>act(true);
        try{
            if(referenceError)throw Error(referenceError);
            review=await prepareInboxShift(api,{request,attendance,profileId,fingerprint,assertCurrent:current});current();
            const row=review.row;
            notes.textContent=[row.occupied&&!declaration?'Only this employee’s duty is confirmed. The coworker keeps their plotted shift.':(!row.attendanceOnly&&!row.alreadyCorrected?'The saved roster will use this shift for this employee on this date.':''),
                row.undatedLeaveIds.length?'A leave has incomplete dates. Confirm only if you verified the employee worked this shift.':''].filter(Boolean).join(' ');
            status.textContent='Recorded attendance · '+time(review.view.timeInAt)+' → '+time(review.view.timeOutAt)+' (PH)';
            if(row.alreadyCorrected)save.textContent=declaration?'Mark reviewed with confirmed shift':'Approve with confirmed shift';
        }catch(error){
            if(active!==state||!node.open)return;
            blocked=true;save.textContent='Open linked attendance';status.textContent=error.message;
        }
        if(active===state&&node.open&&!state.busy)save.disabled=false;
        return node;
    }
    return {open,canOpen};
}
