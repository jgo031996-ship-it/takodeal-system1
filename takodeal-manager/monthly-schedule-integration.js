import {installMonthlyScheduleUI,installScheduleCalendarReviewUI} from './monthly-schedule-ui.js';
import {buildMonthlySchedulePlan} from './monthly-schedule-model.js';
import {toScheduleEmployee} from './schedule-staff-directory.js';
import {canOpenWorkspacePage} from './workspace-access-model.js';
import {monthKey,scheduleDateKey} from './schedule-history.js';
import {scheduleLeaveMarkerIds} from './schedule-leave-markers.js';
import {planScheduleCalendar} from './schedule-calendar.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const fingerprint=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const leaveFields=['type','status','staffId','staffName','branch','startDate','endDate','activeLeaveDates','leaveState','leaveType'];
const sanctionFields=['caseVersion','caseKey','caseNumber','staffId','staffName','branch','status','finding','decisionRevision','reviewedByUid','reviewedByEmail','reviewReason','reviewedAt','reviewedAction','effectiveDate','severity','timestamp','issuedAt'];
const fresh=snapshot=>{
    if(!Array.isArray(snapshot?.docs)||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||snapshot.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('Reconnect to confirm current staff, approved leave and suspension dates with HQ.');
    if(snapshot.docs.length>10000)throw Error('This directory needs a separate HQ review before preparing a month.');
    return snapshot.docs.map(row=>({...row.data(),id:row.id}));
};

// Read scheduling metadata only on an explicit month-creation action. No
// background subscriptions or business writes are introduced here.
export async function readMonthlyScheduleEvidence(w,captured={}){
    const collection=table=>w.collection(w.db,table);
    const [people,leaves,sanctions]=await Promise.all([
        w.getDocsFromServer(collection('cashiers')),
        w.getDocsFromServer(w.query(collection('staff_requests'),w.where('type','==','Leave'),w.where('status','==','Approved'))),
        w.getDocsFromServer(collection('hr_sanctions'))
    ]);
    const from=captured.effectiveFrom,to=captured.month+'-31',ids=scheduleLeaveMarkerIds(captured.snapshot,{branch:captured.branch,from,to}),leaveSources=[];
    for(let at=0;at<ids.length;at+=15){
        const batch=await Promise.all(ids.slice(at,at+15).map(async id=>{
            if(typeof w.getDocFromServer!=='function')throw Error('Reconnect to verify the original saved leave markers.');
            const row=await w.getDocFromServer(w.doc(w.db,'staff_requests',id));
            if(row.metadata?.fromCache||row.metadata?.hasPendingWrites)throw Error('Reconnect to verify the original saved leave markers.');
            return {id,record:row.exists()?pick(row.data(),leaveFields):null};
        }));leaveSources.push(...batch);
    }
    return {
        leaveSources,
        staffProfiles:fresh(people).map(row=>toScheduleEmployee(row,row.id)).filter(Boolean),
        approvedLeaves:fresh(leaves).filter(row=>row.type==='Leave'&&row.status==='Approved').map(row=>({...pick(row,leaveFields),id:row.id})),
        sanctions:fresh(sanctions).map(row=>({...pick(row,sanctionFields),id:row.id}))
    };
}

export function createMonthlyScheduleController(w,d,{getSnapshot,applySnapshot,getBranch,getMonth,getEffectiveFrom,getSync,captureEditor,readEvidence=captured=>readMonthlyScheduleEvidence(w,captured),now=()=>new Date(),installUI=installMonthlyScheduleUI,timeoutMs=25000}={}){
    let evidence=null,opening=null,evidenceFlight=null,ui=null,applying=false,reviewEpoch=0;
    const actor=()=>{
        const user=w.auth?.currentUser,session=w.sessionUser;
        if(!user?.uid||user.emailVerified!==true||session?.uid!==user.uid||String(session.email||'').toLowerCase()!==String(user.email||'').toLowerCase()||session.isFranchisee===true||!canOpenWorkspacePage(session,'schedule'))throw Error('Sign in with your approved Schedule Manager account.');
        return fingerprint([user.uid,user.email,session.uid,session.email,session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches,session.branch,session.assignedBranch]);
    };
    function surface(){
        const actorKey=actor(),month=getMonth(),branch=getBranch(),sync=getSync();
        if(w.scheduleMemoryReadOnly||!sync?.isLoaded?.()||sync.baseline?.()?.month!==month)throw Error('Load the latest selected month before preparing a roster. Saved historical versions are read-only.');
        if(sync.isSaving?.())throw Error('The current schedule save is still waiting for HQ. Confirm its result before preparing another roster.');
        if(typeof branch!=='string'||!branch.trim()||w.isBranchAllowed?.(branch)!==true)throw Error('Choose an approved schedule branch.');
        const snapshot=copy(captureEditor?captureEditor():getSnapshot());
        if(monthKey(snapshot)!==month||!Array.isArray(snapshot.branchConfig?.[branch]))throw Error('The selected month or branch changed. Reload the saved schedule.');
        const today=scheduleDateKey(now()),effectiveFrom=getEffectiveFrom();
        if(month<today.slice(0,7)||typeof effectiveFrom!=='string'||effectiveFrom.slice(0,7)!==month||scheduleDateKey(effectiveFrom)!==effectiveFrom)throw Error('Choose a current or future month and an effective date inside that month.');
        return {snapshot,month,branch,actorKey,effectiveFrom,today,readOnly:false};
    }
    async function evidenceNow(captured){
        const key=fingerprint([captured.actorKey,captured.month,captured.branch]);
        if(evidenceFlight){if(evidenceFlight.key!==key)throw Error('Another month check is still waiting for HQ. Wait for it to finish.');return evidenceFlight.result;}
        const entry={key};let timer;
        entry.physical=Promise.resolve().then(()=>{if(actor()!==captured.actorKey)throw Error('The schedule account changed.');return readEvidence(captured);});
        entry.result=Promise.race([entry.physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ has not confirmed current scheduling records yet. Reconnect and reopen Create Monthly Schedule.')),timeoutMs);})]).finally(()=>clearTimeout(timer));
        evidenceFlight=entry;entry.physical.then(()=>{if(evidenceFlight===entry)evidenceFlight=null;},()=>{if(evidenceFlight===entry)evidenceFlight=null;});
        const result=await entry.result;
        if(!result||!Array.isArray(result.staffProfiles)||!Array.isArray(result.approvedLeaves)||!Array.isArray(result.sanctions))throw Error('The fresh scheduling records are incomplete. No draft was prepared.');
        return copy(result);
    }
    function getContext(){return {...surface(),...copy(evidence||{})};}
    async function commit(plan,captured,{isCurrent=()=>true}={}){
        if(applying)throw Error('This roster draft is already being prepared.');
        applying=true;
        try{
            const epoch=reviewEpoch,before=getContext();if(!isCurrent()||fingerprint(before)!==fingerprint(captured))throw Error('The selected month, branch, staff or editor changed. Review the roster again.');
            const latest=await evidenceNow(before);
            if(epoch!==reviewEpoch||!isCurrent())throw Error('The month creation review was closed. No draft was applied.');
            const current=surface();if(fingerprint(current)!==fingerprint(pick(before,['snapshot','month','branch','actorKey','effectiveFrom','today','readOnly']))||fingerprint(latest)!==fingerprint(evidence))throw Error('Staff, leave, suspension dates or the selected roster changed. Reopen Create Monthly Schedule to review the latest records.');
            const verified=buildMonthlySchedulePlan({...current,...latest,mode:plan.mode});
            if(fingerprint(verified)!==fingerprint(plan))throw Error('The roster proposal changed. Review it again before preparing the draft.');
            if(verified.calendarRepair.changed){
                for(const row of [...verified.calendarRepair.excluded,...verified.calendarRepair.renamed.map(row=>({rows:captured.snapshot.currentSchedule[row.from]}))])for(const branch of Object.keys(row.rows||{}))if(w.isBranchAllowed?.(branch)!==true)throw Error('An extra calendar row includes another branch. An authorized owner must review all affected branches.');
                if(await getSync().preserveCalendarBackup?.()!==true)throw Error('The original calendar backup could not be preserved. Keep this draft open or download it; no repair was applied.');
                if(epoch!==reviewEpoch||!isCurrent()||fingerprint(getContext())!==fingerprint(captured))throw Error('The editor or account changed while preserving the calendar backup. Review again; no repair was applied.');
            }
            const previousDirectory=w.scheduleDirectoryProfiles;
            const installedDirectory=copy(latest.staffProfiles);w.scheduleDirectoryProfiles=installedDirectory;
            try{await applySnapshot(copy(verified.snapshot));}catch(error){let owns=false;try{owns=actor()===captured.actorKey&&getMonth()===captured.month&&getBranch()===captured.branch;}catch{}if(owns&&w.scheduleDirectoryProfiles===installedDirectory)w.scheduleDirectoryProfiles=previousDirectory;throw error;}
            if(actor()!==captured.actorKey||getMonth()!==captured.month||getBranch()!==captured.branch)return {prepared:true,backupConfirmed:false};
            const sync=getSync();sync.markDirty();
            let backupConfirmed=false;try{backupConfirmed=await sync.preserveDraft()===true;}catch{}
            return {prepared:true,backupConfirmed};
        }finally{applying=false;}
    }
    function open(){
        if(opening)return opening;
        opening=(async()=>{
            ++reviewEpoch;
            const before=surface(),button=d.getElementById('btnCreateMonthlySchedule');
            if(button){button.disabled=true;button.textContent='Checking staff and dates…';}
            try{
                const latest=await evidenceNow(before);
                if(fingerprint(surface())!==fingerprint(before))throw Error('The account, month, branch or editor changed during the HQ check. Reopen Create Monthly Schedule.');
                evidence=latest;ui||=installUI(w,d,{getContext,commit,now});return await ui.open();
            }finally{if(button){button.disabled=false;button.textContent='Create Monthly Schedule';}}
        })().catch(error=>{w.ManagerUI?.notify?.(error.message);return false;}).finally(()=>{opening=null;});
        return opening;
    }
    return {open,close:()=>{++reviewEpoch;ui?.close();},getContext,commit,isApplying:()=>applying};
}

// Calendar repair is independent of creating a roster: no HR evidence reads,
// generated assignments or effective-date changes are needed to remove a day
// that cannot exist in the selected month. The original rows remain backed up.
export function createScheduleCalendarReviewController(w,d,{getSnapshot,captureEditor=getSnapshot,applySnapshot,getMonth,getBranch=()=>w.currentActiveTab||'',getEffectiveFrom,getSync,save=()=>w.saveToCloud(),installUI=installScheduleCalendarReviewUI}={}){
    let ui=null,applying=false,epoch=0;
    function surface(){
        const user=w.auth?.currentUser,session=w.sessionUser,sync=getSync(),month=getMonth();
        if(!user?.uid||user.emailVerified!==true||session?.uid!==user.uid||String(session.email||'').toLowerCase()!==String(user.email||'').toLowerCase()||session.isFranchisee===true||!canOpenWorkspacePage(session,'schedule'))throw Error('Sign in with your approved Schedule Manager account.');
        if(w.scheduleMemoryReadOnly||!sync?.isLoaded?.()||sync.baseline?.()?.month!==month)throw Error('Load the latest selected month before reviewing its calendar. Saved historical versions are read-only.');
        if(sync.isSaving?.())throw Error('The schedule save is still waiting for HQ. Confirm its result before another save.');
        const snapshot=copy(captureEditor()),effectiveFrom=getEffectiveFrom(),branch=getBranch();
        if(monthKey(snapshot)!==month)throw Error('The selected month changed. Reopen the calendar review.');
        const actorKey=fingerprint([user.uid,user.email,session.uid,session.email,session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches,session.branch,session.assignedBranch]);
        const plan=planScheduleCalendar(snapshot);
        if(plan.changed&&sync.calendarRepairStatus?.()?.pendingConfirmation===true)throw Error('An earlier schedule save still needs confirmation. Download your current draft, then reload the saved schedule and review Draft recovery before repairing this calendar. Its original save reference has been kept.');
        for(const row of [...plan.excluded,...plan.renamed.map(row=>({rows:snapshot.currentSchedule[row.from]}))])for(const branch of Object.keys(row.rows||{}))if(w.isBranchAllowed?.(branch)!==true)throw Error('An extra calendar row includes another branch. An authorized owner must review all affected branches.');
        return {snapshot,month,branch,effectiveFrom,actorKey,plan};
    }
    async function commit(captured,{isCurrent=()=>true}={}){
        if(applying)throw Error('This calendar repair is already being saved.');
        applying=true;
        try{
            const token=epoch;
            if(!isCurrent()||fingerprint(surface())!==fingerprint(captured))throw Error('The account, month or draft changed. Reopen the calendar review before saving.');
            if(!captured.plan.changed)throw Error('This calendar no longer needs repair. Close the review and use Save Edits.');
            if(await getSync().preserveCalendarBackup?.()!==true)throw Error('The original calendar backup could not be preserved. Keep this draft open or download it; no repair was applied.');
            if(token!==epoch||!isCurrent()||fingerprint(surface())!==fingerprint(captured))throw Error('The account, month or draft changed while preserving its backup. No calendar repair was applied.');
            await applySnapshot(copy(captured.plan.snapshot));
            // A late callback must not save a different account or month.
            const applied=surface();
            if(token!==epoch||!isCurrent()||applied.actorKey!==captured.actorKey||applied.month!==captured.month||applied.branch!==captured.branch||applied.effectiveFrom!==captured.effectiveFrom||fingerprint(applied.snapshot)!==fingerprint(captured.plan.snapshot))throw Error('The editor changed during calendar repair. Its local draft was kept; review it before saving.');
            getSync().markDirty();
            const result=await save();
            if(result!==true)return {saved:false,repaired:true,message:getSync().lastError?.()?.message||d.getElementById('ownerScheduleSyncStatus')?.textContent||'HQ has not confirmed the save.'};
            if(getSync().isDirty?.()===true||getSync().isSaving?.()===true)return {saved:false,repaired:true,confirmed:true,message:'HQ confirmed the original save, but this editor still has additional unsaved changes. Keep the draft and retry Save Edits after reviewing them.'};
            return {saved:true,repaired:true};
        }finally{applying=false;}
    }
    function open(){
        try{
            const captured=surface();
            if(!captured.plan.changed){w.ManagerUI?.notify?.('The calendar is valid. Use Save Edits to save your current draft.');return false;}
            ++epoch;ui||=installUI(w,d,{getContext:surface,commit});return ui.open(captured);
        }catch(error){w.ManagerUI?.notify?.(error.message);return false;}
    }
    return {open,commit,getContext:surface,isApplying:()=>applying,close:()=>{++epoch;ui?.close();}};
}
