import {createWorkedShiftCorrectionService} from './worked-shift-correction-service.js';
import {workedShiftCanonical} from './worked-shift-correction-model.js';
import {OWNER_EMAIL,canOpenWorkspacePage} from './workspace-access-model.js';
import {reviewOriginalLateRequest} from './late-request-resolution.js';
import {acknowledgeScheduleDeclaration,scheduleDeclarationSourceFingerprint} from './attendance-swap-declaration.js';

export function canResolveInboxShift(api,branch){
    const user=api.auth?.currentUser,session=api.sessionUser;
    return Boolean(user?.uid && user.email?.toLowerCase()===OWNER_EMAIL && user.emailVerified===true
        && user.providerData?.some(row=>row.providerId==='google.com') && session?.uid===user.uid
        && session.email?.toLowerCase()===OWNER_EMAIL && session.isOwner===true && !session.isFranchisee
        && canOpenWorkspacePage(session,'inbox') && api.isBranchAllowed?.(branch)===true);
}

// Reuse the existing decision transactions within the roster transaction. Only the
// two schedule documents that this transaction is about to set have a prospective
// value. All identity, request, attendance and payment reads use the real transaction.
function decisionApi(api,tx,changes,current){
    const adapter=Object.create(api);
    adapter.runTransaction=(_db,decide)=>decide({
        async get(ref){
            current();
            const next=changes.find(change=>change.ref.path===ref.path);
            if(next)return {id:ref.id,ref,metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>next.value};
            return tx.get(ref);
        },
        update(ref,patch){current();return tx.update(ref,patch);}
    });
    return adapter;
}

export async function prepareInboxShift(api,{request,attendance,profileId,fingerprint,assertCurrent}){
    const user=api.auth?.currentUser,session=api.sessionUser;
    function current(){
        assertCurrent();
        if(api.auth?.currentUser!==user||api.sessionUser!==session||!canResolveInboxShift(api,request.branch))
            throw Error('Reopen this request with the verified Owner account.');
    }
    current();
    const declaration=request.type==='Schedule Declaration',p=declaration?request.scheduleDeclaration:request.staffShiftProposal;
    if(!p||request.status!=='Pending'||request.attendanceLogId!==attendance.id||request.staffId!==attendance.staffId
        ||request.staffName!==attendance.staffName||request.branch!==attendance.branch
        ||(declaration?p.targetBranch:p.branch)!==request.branch||(!declaration&&request.type!=='Reason Letter'))
        throw Error('Choose the exact saved employee, branch and shift in attendance.');
    if(request.scheduleDeclaration&&scheduleDeclarationSourceFingerprint(request,attendance)!==fingerprint)
        throw Error('Reopen the declaration to check its original clock-in.');
    const service=api.workedShiftCorrectionUI?.service||createWorkedShiftCorrectionService(api);
    const view=await service.inspect({attendanceLogId:attendance.id,staffId:request.staffId,branch:request.branch,workDate:p.workDate});
    current();
    if(view.blockers.length)throw Error(view.blockers.join(' '));
    const sameInstant=(a,b)=>Number.isFinite(Date.parse(a))&&Date.parse(a)===Date.parse(b);
    const rows=view.choices.filter(row=>row.workDate===p.workDate && row.shiftId===(declaration?p.targetShiftId:p.shiftId)
        && row.reportedRevisionId===p.sourceRevisionId && sameInstant(row.expectedStartAt,declaration?p.targetStartAt:p.expectedStartAt)
        && sameInstant(row.expectedEndAt,declaration?p.targetEndAt:p.expectedEndAt)
        && (!declaration||row.occupied&&row.plottedName===p.targetAssignedName));
    if(rows.length!==1)throw Error('The reported slot differs from the saved roster. Open the linked attendance to choose the worked shift.');
    const row=rows[0];
    if(row.blockers.length)throw Error(row.blockers.join(' '));
    if(declaration){
        const sourceKeys=['coworkerStaffId','coworkerName','coworkerHomeBranch','workDate','targetBranch','targetShiftId',
            'targetShiftName','targetAssignedName','targetStartAt','targetEndAt','sourceRevisionId'];
        const source=Object.fromEntries(sourceKeys.map(key=>[key,p[key]]));
        const punchKeys=['branch','staffName','shiftId','shiftName','shiftType','expectedStartAt','expectedEndAt','scheduleRevisionId',
            'wasScheduled','needsScheduleReview','scheduleReviewReason'];
        const punch=JSON.stringify(punchKeys.map(key=>attendance.scheduleSnapshot?.[key]??null));
        if(punch!==p.originalScheduleFingerprint || row.shiftName!==p.targetShiftName
            || workedShiftCanonical({...source,shiftType:row.shiftType,amendmentIds:row.slotAmendmentIds})!==p.sourceFingerprint)
            throw Error('The declaration differs from its saved punch or roster. Review the linked attendance.');
    }
    const expected=workedShiftCanonical(request);
    let proposal;
    return {row,view,async save(reply=''){
        current();
        if(reply.length>1500)throw Error('Keep the reply within 1,500 characters.');
        proposal??=service.propose(view,row.key);
        return service.apply(proposal,async(tx,changes,result)=>{
            current();
            const ref=api.doc(api.db,'staff_requests',request.id),snapshot=await tx.get(ref);
            current();
            if(!snapshot.exists()||snapshot.metadata?.fromCache!==false||snapshot.metadata?.hasPendingWrites!==false)
                throw Error('Reconnect and reopen the saved request.');
            const saved={...snapshot.data(),id:request.id};
            const linked=saved.ownerShiftResolution;
            if(linked?.revisionId===result.revisionId && linked.attendanceId===attendance.id
                && linked.ownerUid===user.uid && saved.status===(declaration?'Reviewed':'Approved')
                && (declaration||saved.managerReply===reply))return;
            if(workedShiftCanonical(saved)!==expected)throw Error('The request changed. Reopen it before deciding.');
            const bound=decisionApi(api,tx,changes,current);
            if(declaration){
                await acknowledgeScheduleDeclaration(bound,{requestId:request.id,attendanceId:attendance.id,branch:request.branch,expectedFingerprint:fingerprint});
            }else{
                await reviewOriginalLateRequest(bound,{requestId:request.id,attendanceId:attendance.id,profileId,
                    action:'Approved',reply,actor:session.cashierName||'Owner',expectedDeclaration:fingerprint});
            }
            current();
            const patch={ownerShiftResolution:{revisionId:result.revisionId,attendanceId:attendance.id,shiftId:row.shiftId,
                workDate:row.workDate,ownerUid:user.uid,recordedAt:api.serverTimestamp()}};
            if(declaration)patch.managerReply='Owner confirmed the worked shift and reviewed the statement.';
            tx.update(ref,patch);
        });
    }};
}
