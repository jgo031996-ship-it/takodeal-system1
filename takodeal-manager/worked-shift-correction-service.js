import {createScheduleHistoryStore,scheduleDateKey} from './schedule-history.js';
import {resolveAttendanceShift} from './payroll-safety.js';
import {attendanceKind,attendanceMillis} from './attendance-reconcile.js';
import {OWNER_EMAIL,canOpenWorkspacePage,createWorkspaceSession} from './workspace-access-model.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {ordinaryPayrollId} from './payroll-settlement.js';
import {planWorkedShiftCorrection,createWorkedShiftRevision,workedShiftCanonical,workedShiftValidId,workedShiftPair,workedShiftAttendanceEvidence,workedShiftSourceFingerprint} from './worked-shift-correction-model.js';

const MAX_ROWS=2000,MAX_REFS=480,DAY=86400000;
const lower=value=>String(value??'').trim().toLowerCase(),copy=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const data=snapshot=>snapshot.exists()?snapshot.data():null;
function fresh(snapshot){if(!snapshot||snapshot.metadata?.fromCache!==false||snapshot.metadata?.hasPendingWrites!==false||typeof snapshot.exists!=='function'&&!Array.isArray(snapshot.docs))throw Error('Reconnect to HQ to confirm the saved worked-shift sources.');return snapshot;}
const profileFields=['id','staffId','cashierName','fullName','scheduleName','scheduleNickname','nickname','scheduleAliases','branch','active','isActive','archived','blocked','deleted','status','employmentStatus','pin','securityPin','role'];
const project=(table,row,id)=>{if(row==null)return null;const saved=table==='settings'?row:{...row,id};return table==='attendance_logs'?workedShiftAttendanceEvidence(saved):table==='cashiers'?Object.fromEntries(profileFields.filter(key=>saved[key]!==undefined).map(key=>[key,saved[key]])):saved;};
function ownerKey(api){
    const user=api.auth?.currentUser,session=api.sessionUser;
    if(!user?.uid||lower(user.email)!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||lower(session.email)!==OWNER_EMAIL||session.isOwner!==true||session.isFranchisee===true||!canOpenWorkspacePage(session,'schedule')||!canOpenWorkspacePage(session,'payroll'))throw Error('Sign in with the verified Owner Google account to apply a worked-shift correction.');
    return workedShiftCanonical([user.uid,user.email,session.uid,session.email,session.isOwner,session.isFranchisee,session.role,session.permissions,session.allowedBranches]);
}
function contextOf(input){
    const context=Object.fromEntries(['attendanceLogId','staffId','branch','workDate','from','to'].filter(key=>input?.[key]!==undefined).map(key=>[key,input[key]]));
    if(context.attendanceLogId&&!workedShiftValidId(context.attendanceLogId)||context.staffId&&!workedShiftValidId(context.staffId)||!context.attendanceLogId&&!context.staffId||context.branch!==undefined&&(typeof context.branch!=='string'||!context.branch.trim()||context.branch.length>120))throw Error('Choose the exact employee, branch and worked attendance record.');
    for(const key of ['workDate','from','to'])if(context[key]!==undefined&&scheduleDateKey(context[key])!==context[key])throw Error('Choose the exact Philippine work date and payroll cutoff.');
    if((context.from||context.to)&&(!context.from||!context.to||context.from>context.to)||!context.attendanceLogId&&(!context.workDate||!context.branch))throw Error('Choose a valid saved work date or exact Time In.');
    return context;
}
function authority(api,key,accounts,branch){
    if(ownerKey(api)!==key||branch&&api.isBranchAllowed?.(branch)===false)throw Error('The Owner account or branch access changed. Reopen this worked shift.');
    const account=resolveHQAccount(accounts.map(row=>({id:row.id,data:row})));
    if(account.active===false||account.archived===true||account.blocked===true||/blocked|disabled|inactive|revoked/i.test(String(account.status||''))||/^(REVOKED|BLOCKED)$/i.test(savedPin(account)))throw Error('The saved Owner account is inactive.');
    const saved=createWorkspaceSession(api.auth.currentUser,account);
    if(saved.isOwner!==true||!canOpenWorkspacePage(saved,'schedule')||!canOpenWorkspacePage(saved,'payroll'))throw Error('The saved Owner account needs Schedule Manager and payroll access.');
}
async function digest(value,cryptoImpl){if(!cryptoImpl?.subtle)throw Error('Secure correction fingerprinting is unavailable. Reload the Owner app.');return [...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(value=>value.toString(16).padStart(2,'0')).join('');}
function paymentGuards(staffId,dates,context){
    const result=new Set();
    for(const day of dates){const last=new Date(Date.UTC(+day.slice(0,4),+day.slice(5,7),0)).getUTCDate(),ranges=[[day.slice(0,7)+(Number(day.slice(-2))<=15?'-01':'-16'),day.slice(0,7)+(Number(day.slice(-2))<=15?'-15':'-'+last)]];if(context.from&&context.to&&context.from<=day&&context.to>=day)ranges.push([context.from,context.to]);for(const [start,end]of ranges){const id=ordinaryPayrollId(staffId,start,end);result.add(id);result.add('refund-'+id);}}
    return [...result];
}
export function createWorkedShiftCorrectionService(api,{now=()=>new Date(),makeId=()=>globalThis.crypto.randomUUID(),crypto=api.crypto||globalThis.crypto,readAttendance,timeoutMs=25000}={}){
    const inspections=new WeakMap(),proposals=new WeakMap(),pending=new Map(),attempts=new Map(),ref=(table,id)=>api.doc(api.db,table,id);
    function guard(key,user,session,branch){if(api.auth?.currentUser!==user||api.sessionUser!==session||ownerKey(api)!==key||branch&&api.isBranchAllowed?.(branch)===false)throw Error('The Owner account, branch or selected worked shift changed. Reopen this correction.');}
    function bounded(slot,work){if(pending.has(slot))return pending.get(slot);const physical=Promise.resolve().then(work);let timer;const visible=Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('HQ has not confirmed this correction yet. Keep this same correction and retry its saved outcome.'),{code:'worked-shift/pending',settled:physical})),timeoutMs);})]).finally(()=>clearTimeout(timer));pending.set(slot,visible);physical.finally(()=>{if(pending.get(slot)===visible)pending.delete(slot);}).catch(()=>{});return visible;}
    async function inspect(input){
        const context=contextOf(input),key=ownerKey(api),user=api.auth.currentUser,session=api.sessionUser,refs=new Map();guard(key,user,session,context.branch);
        const remember=(table,id,row)=>{const path=table+'/'+id,value=project(table,row,id);if(refs.has(path)&&workedShiftCanonical(refs.get(path).value)!==workedShiftCanonical(value))throw Error('A source changed while this correction was loading. Reopen its exact records.');refs.set(path,{table,id,value});if(refs.size>MAX_REFS)throw Error('This history is too large for a safe one-date correction.');};
        const document=async reference=>{guard(key,user,session,context.branch);const snapshot=fresh(await api.getDocFromServer(reference));guard(key,user,session,context.branch);if(snapshot.id!==reference.id)throw Error('HQ returned a different saved source.');const path=reference.path||'',table=path.split('/').at(-2);if(!table)throw Error('The correction source reference is invalid.');remember(table,reference.id,data(snapshot));return snapshot;};
        const get=async(table,id)=>data(await document(ref(table,id)));
        const queryRows=async(table,filters=[])=>{if(typeof api.limit!=='function')throw Error('Bounded source reads are still loading. Reload the Owner app.');guard(key,user,session,context.branch);const snapshot=fresh(await api.getDocsFromServer(api.query(api.collection(api.db,table),...filters,api.limit(MAX_ROWS+1))));guard(key,user,session,context.branch);if(snapshot.docs.length>MAX_ROWS)throw Error('Too many saved records need verification for this one-date correction.');return snapshot.docs.map(document=>{fresh(document);const row={...document.data(),id:document.id};remember(table,document.id,row);return row;});};
        const [original,accounts]=await Promise.all([context.attendanceLogId?get('attendance_logs',context.attendanceLogId):null,queryRows('hq_managers',[api.where('email','==',OWNER_EMAIL)])]);
        let start=original;
        if(context.attendanceLogId&&(!start||!workedShiftValidId(start.staffId)))throw Error('The original Time In with its stable employee ID is unavailable.');
        const staffId=context.staffId||start.staffId,profile=await get('cashiers',staffId);
        if(!accounts.length||accounts.length>10)throw Error('The saved Owner account needs review.');authority(api,key,accounts,context.branch||start?.branch);
        if(!profile||typeof profile.cashierName!=='string'||!profile.cashierName.trim())throw Error('The saved employee identity needs review.');
        const name=start?.staffName||profile.cashierName;
        const center=start?attendanceMillis(start.timestamp):Date.parse(context.workDate+'T00:00:00+08:00');
        if(!Number.isFinite(center))throw Error('The saved actual work date could not be confirmed.');
        let records;
        if(readAttendance)records=await readAttendance({staffId,staffName:name,profile,context});
        else{
            if(typeof api.limit!=='function')throw Error('Bounded attendance reads are still loading. Reload the Owner app.');
            const from=center-2*DAY,to=center+2*DAY;
            const snapshot=fresh(await api.getDocsFromServer(api.query(api.collection(api.db,'attendance_logs'),api.where('timestamp','>=',new Date(from)),api.where('timestamp','<',new Date(to)),api.limit(MAX_ROWS+1))));
            guard(key,user,session,context.branch);
            if(snapshot.docs.length>MAX_ROWS)throw Error('Too many attendance records exist in this work-date window. Review a narrower source separately.');
            records=snapshot.docs.map(document=>{fresh(document);const row={...document.data(),id:document.id},at=attendanceMillis(row.timestamp);if(!Number.isFinite(at)||at<from||at>=to)throw Error('HQ returned attendance outside the selected work-date window.');return row;}).filter(row=>row.staffId===staffId||!row.staffId&&row.staffName===name);
        }
        guard(key,user,session,context.branch);
        if(!Array.isArray(records)||records.length>MAX_ROWS||records.some(row=>!workedShiftValidId(row.id)))throw Error('The attendance history needs a separate identity review.');
        records=records.filter(row=>(row.staffId===staffId||!row.staffId&&row.staffName===name)&&Math.abs(attendanceMillis(row.timestamp)-center)<=2*DAY);for(const row of records)remember('attendance_logs',row.id,row);
        if(!start){
            const selected=records.filter(row=>!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status)&&attendanceKind(row)==='TIME IN'&&row.branch===context.branch&&(scheduleDateKey(new Date(attendanceMillis(row.timestamp)))===context.workDate||row.scheduleSnapshot?.expectedStartAt&&scheduleDateKey(row.scheduleSnapshot.expectedStartAt)===context.workDate));
            if(selected.length!==1){const view=freeze({status:selected.length?'choose-record':'blocked',staffId,staffName:name,branch:context.branch,workDate:context.workDate,recordChoices:selected.map(row=>{let pair;try{pair=workedShiftPair(records,row);}catch{}return {attendanceLogId:row.id,timeInAt:new Date(attendanceMillis(row.timestamp)).toISOString(),timeOutAt:pair?.timeOutAt||null,branch:row.branch,workDate:context.workDate};}),choices:[],recommendedKey:null,blockers:[selected.length?'Choose the exact saved Time In for this date.':'No saved Time In could be confirmed for this employee and work date.']});return view;}
            start=selected[0];
        }
        start={...start,id:context.attendanceLogId||start.id};
        if(start.staffId!==staffId||context.staffId&&context.staffId!==start.staffId||context.branch&&context.branch!==start.branch)throw Error('The selected attendance employee or branch changed.');
        if(!records.some(row=>row.id===start.id&&workedShiftCanonical(workedShiftAttendanceEvidence(row))===workedShiftCanonical(workedShiftAttendanceEvidence(start))))throw Error('The exact saved Time In changed while attendance was loading.');
        const linked=await queryRows('attendance_logs',[api.where('timeInLogId','==',start.id)]);
        records=[...new Map([...records,...linked].map(row=>[row.id,row])).values()];
        const pair=workedShiftPair(records,start),out=pair.out,at=attendanceMillis(start.timestamp);
        const tracked={...api,getDocFromServer:document},historyPromise=createScheduleHistoryStore(tracked).loadRange(new Date(at-DAY),new Date(at+DAY));
        const search=async table=>{const rows=await Promise.all([queryRows(table,[api.where('staffId','==',staffId)]),queryRows(table,[api.where('staffName','==',start.staffName)])]);return [...new Map(rows.flat().map(row=>[row.id,row])).values()];};
        const [history,leaves,sanctions,payroll,claims,head]=await Promise.all([historyPromise,search('staff_requests'),search('hr_sanctions'),search('payroll_records'),get('settings','schedule_leave_staff_'+staffId),get('attendance_shift_confirmations',start.id)]);
        if(head)history.payrollShiftConfirmations={[start.id]:head};
        guard(key,user,session,start.branch);authority(api,key,accounts,start.branch);
        const matched=resolveAttendanceShift(start,history,{[start.staffName]:{...profile,staffId}},start.staffName);
        if(matched.payrollShiftConfirmationError||matched.reliefNeedsReview||matched.amendmentNeedsReview)throw Error('The existing Owner attendance review must be resolved before correcting its roster.');
        const plan=planWorkedShiftCorrection({start,out,profile,history,attendance:records,leaves,sanctions,payroll,claims,matchedShift:matched,context,now:now()});plan.sourceFingerprint=workedShiftSourceFingerprint(start);
        if(matched.payrollHoursConfirmed||matched.reliefReviewVerified)for(const choice of plan.choices)if(attendanceMillis(matched.expectedStartAt)!==Date.parse(choice.expectedStartAt)||attendanceMillis(matched.expectedEndAt)!==Date.parse(choice.expectedEndAt))choice.blockers.push('Existing Owner-confirmed hours differ from this slot. Resolve that saved review separately.');
        if(plan.recommendedKey&&plan.choices.find(row=>row.key===plan.recommendedKey)?.blockers.length)plan.recommendedKey=null;
        if(plan.sourceFingerprint.length>30000)throw Error('The original punch snapshot is too large for a compact dated correction.');
        for(const id of paymentGuards(staffId,[...new Set([scheduleDateKey(new Date(at)),...plan.choices.map(row=>row.workDate)])],context)){const row=await get('payroll_records',id);if(row&&!payroll.some(saved=>saved.id===id))payroll.push({...row,id});}
        // Sentinel reads also catch a payment created between the query and save.
        for(const choice of plan.choices)if(payroll.some(row=>(!row.staffId||row.staffId===staffId)&&(row.frozenData||row.isPaid===true||Number.isFinite(row.finalNetPay))&&row.startDate<=choice.workDate&&row.endDate>=choice.workDate)&&!choice.blockers.some(reason=>/paid payslip/.test(reason)))choice.blockers.push('A paid payslip covers this work date. Its figures stay frozen.');
        if(plan.recommendedKey&&plan.choices.find(row=>row.key===plan.recommendedKey)?.blockers.length)plan.recommendedKey=null;
        // A historical correction never depends on unrelated current planning.
        refs.delete('settings/global_schedule');
        const expectedFingerprint=await digest(workedShiftCanonical([...refs].sort(([a],[b])=>a.localeCompare(b)).map(([path,row])=>[path,row.value])),crypto);guard(key,user,session,start.branch);
        const view=freeze({status:plan.blockers.length?'blocked':'ready',context:{...context,attendanceLogId:start.id,staffId,branch:start.branch},staffId,staffName:start.staffName,branch:start.branch,attendanceLogId:start.id,timeOutLogId:out.id,timeInAt:plan.timeInAt,timeOutAt:plan.timeOutAt,workedHours:plan.workedHours,preservedLateness:copy(plan.preservedLateness),choices:plan.choices.map(({basis,...choice})=>copy(choice)),recommendedKey:plan.recommendedKey,blockers:[...plan.blockers],expectedFingerprint,recordChoices:[]});
        inspections.set(view,{key,user,session,accounts,refs,plan,history,context:view.context});return view;
    }
    function propose(view,choiceKey=view?.recommendedKey){
        const saved=inspections.get(view);if(!saved)throw Error('Inspect this exact worked shift before applying its correction.');guard(saved.key,saved.user,saved.session,view.branch);
        const choice=saved.plan.choices.find(row=>row.key===choiceKey);if(!choice||view.blockers.length||choice.blockers.length)throw Error(choice?.blockers[0]||view.blockers[0]||'Choose one saved shift slot from this work date.');
        const slot=saved.key+'|'+view.attendanceLogId,existing=attempts.get(slot);
        if(existing){if(existing.choiceKey!==choiceKey||existing.expectedFingerprint!==view.expectedFingerprint)throw Error('A different correction is still pending for this Time In. Retry its original outcome first.');return existing;}
        const operationId=makeId();if(!workedShiftValidId(operationId)||operationId.length>80)throw Error('The correction reference could not be prepared.');
        const proposal=freeze({operationId,choiceKey,expectedFingerprint:view.expectedFingerprint,context:copy(view.context),workDate:choice.workDate,staffId:view.staffId,branch:view.branch});proposals.set(proposal,saved);attempts.set(slot,proposal);return proposal;
    }
    function apply(proposal){
        const saved=proposals.get(proposal);if(!saved)return Promise.reject(Error('Use the original inspected correction before applying this worked shift.'));
        const {key,user,session,refs,plan}=saved,slot=key+'|apply|'+proposal.operationId;
        return bounded(slot,async()=>{
            let mayHaveWritten=false;
            try{
            guard(key,user,session,proposal.branch);
            const actor={uid:user.uid,email:OWNER_EMAIL},revisionId='worked-'+proposal.operationId,intent=await digest(workedShiftCanonical({proposal,actor}),crypto);
            const priorSnapshot=fresh(await api.getDocFromServer(ref('settings','schedule_revision_'+revisionId)));
            guard(key,user,session,proposal.branch);
            if(!priorSnapshot.exists()){
                const refreshed=await inspect(saved.context);
                if(refreshed.expectedFingerprint!==proposal.expectedFingerprint)throw Error('The saved roster, attendance, payment or leave changed. Reopen this exact worked-shift correction.');
            }
            const result=await api.runTransaction(api.db,async tx=>{
                guard(key,user,session,proposal.branch);
                const prior=data(fresh(await tx.get(ref('settings','schedule_revision_'+revisionId))));
                const live=new Map(await Promise.all([...refs].map(async([name,row])=>{const snapshot=fresh(await tx.get(ref(row.table,row.id)));return [name,{...row,value:project(row.table,data(snapshot),row.id)}];})));
                const accounts=[...live].filter(([name])=>name.startsWith('hq_managers/')).map(([,row])=>row.value&&({...row.value,id:row.id})).filter(Boolean);authority(api,key,accounts,proposal.branch);
                if(prior){if(prior.source!=='owner-worked-shift'||prior.revisionId!==revisionId||prior.intent!==intent||prior.historicalWorkedShiftReview?.reviewedByUid!==actor.uid||prior.historicalWorkedShiftReview?.timeInLogId!==plan.attendanceLogId)throw Error('This correction reference belongs to different saved details.');return {alreadySaved:true,revisionId,workDate:proposal.workDate,staffId:proposal.staffId};}
                for(const [name,row]of refs)if(workedShiftCanonical(live.get(name)?.value)!==workedShiftCanonical(row.value))throw Error('The saved roster, attendance, payment or leave changed. Reopen this exact worked-shift correction.');
                const selected=plan.choices.find(choice=>choice.key===proposal.choiceKey);
                if(selected?.alreadyCorrected)return {alreadySaved:true,revisionId:selected.existingCorrectionId,workDate:proposal.workDate,staffId:proposal.staffId,shiftId:selected.shiftId,preservedLateness:copy(plan.preservedLateness)};
                const month=proposal.workDate.slice(0,7),index=live.get('settings/schedule_month_'+month.replace('-','_'))?.value;
                if(!index||!Array.isArray(index.revisionIds)||index.latestRevisionId&&!index.revisionIds.includes(index.latestRevisionId))throw Error('The dated schedule index is incomplete.');
                const policy=live.get('settings/schedule_history_policy')?.value;
                const revision=createWorkedShiftRevision(plan,proposal.choiceKey,{operationId:proposal.operationId,actor,at:now(),index,cutover:policy?.payrollHistoryEnforcedFrom||saved.history.payrollHistoryEnforcedFrom});revision.intent=intent;
                revision.sequence=Math.max(index.revisionIds.length,...[...live].filter(([name])=>name.startsWith('settings/schedule_revision_')).map(([,row])=>Number(row.value?.sequence)||0))+1;
                const next={...copy(index),schemaVersion:1,kind:'schedule-month',month,revisionIds:[...new Set([...index.revisionIds,revisionId])],updatedAt:revision.savedAt};
                if(new TextEncoder().encode(JSON.stringify(next)).length>950000)throw Error('The dated schedule index is too large to update safely.');
                guard(key,user,session,proposal.branch);
                mayHaveWritten=true;
                tx.set(ref('settings','schedule_revision_'+revisionId),revision);tx.set(ref('settings','schedule_month_'+month.replace('-','_')),next);
                return {alreadySaved:false,revisionId,workDate:proposal.workDate,staffId:proposal.staffId,shiftId:revision.historicalWorkedShiftReview.shiftId,preservedLateness:copy(plan.preservedLateness)};
            });
            guard(key,user,session,proposal.branch);
            if(attempts.get(key+'|'+plan.attendanceLogId)===proposal)attempts.delete(key+'|'+plan.attendanceLogId);
            return result;
            }catch(error){if(!mayHaveWritten&&attempts.get(key+'|'+plan.attendanceLogId)===proposal)attempts.delete(key+'|'+plan.attendanceLogId);throw error;}
        });
    }
    return {inspect,propose,apply};
}
