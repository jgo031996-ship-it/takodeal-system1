import {createScheduleHistoryStore, monthKey, scheduleDateKey, resolveScheduleForDate} from './schedule-history.js';
import {canOpenWorkspacePage, OWNER_EMAIL} from './workspace-access-model.js';

const copy = value => JSON.parse(JSON.stringify(value));
const fields = ['branchConfig','currentSchedule','employees','unavailability','holidays','currentYear','currentMonth'];
const exactName = value => typeof value === 'string' ? value.trim() : '';
const validPerson = value => !!exactName(value) && !['N/A','UNFILLED','STANDBY','-'].includes(exactName(value));
function canonical(value) { return Array.isArray(value) ? '['+value.map(canonical).join(',')+']' : value && typeof value==='object' ? '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}' : JSON.stringify(value); }
function fingerprint(snapshot) { return canonical(Object.fromEntries(fields.filter(key=>snapshot?.[key]!==undefined).map(key=>[key,snapshot[key]]))); }
function authority(api, request) {
    const session = api.sessionUser, user = api.auth?.currentUser;
    if (!session || !user?.uid || !exactName(user.email) || user.uid !== session.uid || exactName(user.email).toLowerCase() !== exactName(session.email).toLowerCase() || user.emailVerified === false || !canOpenWorkspacePage(session,'schedule')) throw Error('Your signed-in account does not have Schedule Manager access.');
    const branches = Array.isArray(session.allowedBranches) ? session.allowedBranches : [];
    if (request && !(session.email.toLowerCase() === OWNER_EMAIL || branches.includes('All') || branches.includes(request.branch))) throw Error('This branch is outside your assigned access.');
    return {uid:user.uid,email:user.email};
}
function validateRequest(request, at) {
    if (!request || request.status !== 'Awaiting HQ Approval') throw Error('This swap is no longer awaiting HQ approval. Refresh the list.');
    if (!request.workDate || request.acceptanceVersion !== 1 || !request.acceptedByStaffId) throw Error('Ask staff to resend and accept this swap with its exact work date.');
    const date = scheduleDateKey(request.workDate);
    if (request.sourceScheduleMonth !== date.slice(0,7)) throw Error('The swap date and source schedule month do not match.');
    if (date < scheduleDateKey(at)) throw Error('This swap date has already passed. Past schedules are not rewritten.');
    const day = Number(date.slice(-2));
    if (request.dayIndex !== undefined && Number(request.dayIndex) !== day) throw Error('The swap date and calendar day do not match.');
    if (!exactName(request.branch) || !request.requesterShiftId || !request.targetShiftId || request.requesterShiftId === request.targetShiftId || request.requesterShiftId === 'STANDBY') throw Error('The swap request has invalid branch or shift details.');
    const requester = exactName(request.requesterAssignedName || request.requesterName), target = exactName(request.targetAssignedName || request.targetName);
    if (!validPerson(requester) || !validPerson(target) || requester === target) throw Error('The swap needs two distinct staff assignments.');
    return {date,day,requester,target};
}
export function buildApprovedSwapSnapshot(snapshot, request, at = new Date()) {
    const {date,day,requester,target} = validateRequest(request,at);
    if (monthKey(snapshot) !== date.slice(0,7)) throw Error('The swap is outside the loaded schedule month.');
    const output=copy(snapshot), data=output.currentSchedule?.[day]?.[request.branch], shifts=output.branchConfig?.[request.branch];
    if (!data?.scheduled || !Array.isArray(shifts)) throw Error('The requested branch day has no saved schedule.');
    const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
    const shiftExists=id=>shifts.some(shift=>shift.id===id && shift.active!==false && (!Array.isArray(shift.days)||shift.days.includes(weekday)));
    if (!shiftExists(request.requesterShiftId) || request.targetShiftId!=='STANDBY'&&!shiftExists(request.targetShiftId)) throw Error('A requested shift is no longer active.');
    if (exactName(data.scheduled[request.requesterShiftId])!==requester) throw Error('The requester’s exact shift assignment changed. Ask staff to submit a new swap.');
    if (request.targetShiftId==='STANDBY') {
        if (!Array.isArray(data.rest) || data.rest.filter(name=>exactName(name)===target).length!==1) throw Error('The target’s exact rest-day assignment changed.');
    } else if (exactName(data.scheduled[request.targetShiftId])!==target) throw Error('The target’s exact shift assignment changed. Ask staff to submit a new swap.');
    if ((data.unavailable||[]).some(row=>[requester,target].includes(exactName(row.name)))) throw Error('One of these staff members is marked unavailable on the swap date.');
    data.swaps ||= {};
    if (request.targetShiftId==='STANDBY') {data.rest=data.rest.filter(name=>exactName(name)!==target);if (!data.rest.some(name=>exactName(name)===requester))data.rest.push(requester);}
    else {data.scheduled[request.targetShiftId]=requester;data.swaps[request.targetShiftId]=target;}
    data.scheduled[request.requesterShiftId]=target;data.swaps[request.requesterShiftId]=requester;
    return output;
}
function requestFingerprint(request) {return canonical(Object.fromEntries(['branch','workDate','sourceScheduleMonth','sourceRevisionId','dateStr','dayIndex','requesterName','targetName','requesterAssignedName','targetAssignedName','requesterShiftId','targetShiftId','acceptanceVersion','acceptedByStaffId'].filter(key=>request[key]!==undefined).map(key=>[key,request[key]])));}
async function readSwap(api,id) {
    if (typeof id!=='string' || !id || id.includes('/')) throw Error('Select a valid swap request.');
    const read=api.getDocFromServer||api.getDoc, snap=await read(api.doc(api.db,'shift_swaps',id));
    if (!snap.exists())throw Error('The swap request no longer exists.');return snap.data();
}
export async function approveScheduleSwap(api,id,{store=api.getScheduleHistoryStore?.()||createScheduleHistoryStore(api),now=()=>new Date()}={}) {
    authority(api);const original=await readSwap(api,id), at=now();authority(api,original);const {date,day}=validateRequest(original,at);
    const archive=await store.loadMonth(date.slice(0,7)), read=api.getDocFromServer||api.getDoc, globalSnap=await read(api.doc(api.db,'settings','global_schedule'));
    const current=globalSnap.exists()?globalSnap.data():null;
    const currentMatches=current&&monthKey(current)===date.slice(0,7);
    const selected=resolveScheduleForDate({historyMonths:{[date.slice(0,7)]:archive}},date);
    if(original.sourceRevisionId && selected?.scheduleRevisionId !== original.sourceRevisionId)throw Error('The schedule version changed since staff requested this swap. Ask staff to submit a new request.');
    const base=currentMatches?copy(current):archive.latestRevision?.snapshot?copy(archive.latestRevision.snapshot):null;
    if (!base || !selected && !currentMatches)throw Error('No saved schedule covers the requested swap date.');
    if (selected) {base.branchConfig=copy(selected.branchConfig);base.currentSchedule ||= {};base.currentSchedule[day]=copy(selected.currentSchedule[day]);}
    const updated=buildApprovedSwapSnapshot(base,original,at), identity=authority(api,original), expectedGlobal=currentMatches?fingerprint(current):null;
    return store.save(updated,{effectiveFrom:date,effectiveTo:date,expectedRevisionId:archive.latestRevisionId||null,actor:identity.email,source:'hq-approved-swap',
        readExtra:async(transaction,context)=>{
            const liveIdentity=authority(api,original);if (liveIdentity.uid!==identity.uid||liveIdentity.email!==identity.email)throw Error('The signed-in account changed. Refresh before reviewing.');
            const ref=api.doc(api.db,'shift_swaps',id), snap=await transaction.get(ref);if(!snap.exists())throw Error('The swap request no longer exists.');
            const request=snap.data();authority(api,request);validateRequest(request,now());
            if(requestFingerprint(request)!==requestFingerprint(original))throw Error('The swap request changed while you were reviewing it.');
            if(expectedGlobal && fingerprint(context.current)!==expectedGlobal)throw Error('The live schedule changed. Reload before approving this swap.');
            return {ref,request,revisionId:context.revision.revisionId};
        },
        writeExtra:(transaction,extra)=>transaction.set(extra.ref,{...extra.request,status:'Approved',hqApprovedBy:identity.email,hqApprovedUid:identity.uid,hqApprovedAt:api.serverTimestamp?.()||at.toISOString(),scheduleRevisionId:extra.revisionId,historyEffectiveFrom:date})});
}
export async function rejectScheduleSwap(api,id,{reason='Declined by management',now=()=>new Date()}={}) {
    const identity=authority(api);return api.runTransaction(api.db,async transaction=>{
        const ref=api.doc(api.db,'shift_swaps',id),snap=await transaction.get(ref);if(!snap.exists())throw Error('The swap request no longer exists.');const request=snap.data();
        const live=authority(api,request);if(live.uid!==identity.uid||live.email!==identity.email)throw Error('The signed-in account changed.');validateRequest(request,now());
        transaction.set(ref,{...request,status:'Rejected by HQ',hqRejectedBy:identity.email,hqRejectedUid:identity.uid,hqRejectedAt:api.serverTimestamp?.()||now().toISOString(),hqRejectionReason:String(reason).trim()||'Declined by management'});
        return {status:'Rejected by HQ'};
    });
}
export function installScheduleSwapReview(api,document) {
    const view=document.getElementById('view-schedule');if(!view)return null;
    if(document.getElementById('scheduleSwapReviewPanel'))return api.scheduleSwapReviewUI||null;
    const panel=document.createElement('section');panel.id='scheduleSwapReviewPanel';panel.className='schedule-memory-panel';panel.style.cssText='display:block;margin-bottom:20px;padding:18px;border:1px solid #dbe5df;border-radius:12px;background:white;';
    const heading=document.createElement('div');heading.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;';const title=document.createElement('strong');title.textContent='Staff swap approvals';
    const refreshButton=document.createElement('button');refreshButton.type='button';refreshButton.className='action-btn';refreshButton.textContent='Refresh requests';heading.append(title,refreshButton);
    const description=document.createElement('p');description.textContent='Review swaps accepted by both staff members. Approval saves the changed date and its original shift rules in schedule memory.';description.style.cssText='font-size:13px;color:#6b8175;line-height:1.6;';
    const status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='font-size:13px;line-height:1.6;';const list=document.createElement('div');panel.append(heading,description,status,list);
    const memory=document.getElementById('scheduleMemoryPanel');if(memory)memory.after(panel);else view.prepend(panel);
    let generation=0,busy=false;
    const refresh=async()=>{
        const token=++generation;list.replaceChildren();try{authority(api);}catch(error){panel.hidden=true;panel.style.display='none';return;}panel.hidden=false;panel.style.display='block';status.style.color='#415c4f';status.textContent='Loading accepted swaps…';
        try{const snap=await api.getDocs(api.query(api.collection(api.db,'shift_swaps'),api.where('status','==','Awaiting HQ Approval')));if(token!==generation)return;authority(api);
            const rows=[];snap.forEach(doc=>{const row={...doc.data(),id:doc.id};try{authority(api,row);rows.push(row);}catch{/* Only assigned branches are listed. */}});rows.sort((a,b)=>String(a.workDate).localeCompare(String(b.workDate)));
            status.textContent=rows.length?`${rows.length} accepted swap${rows.length===1?'':'s'} waiting for HQ review.`:'No accepted swaps are awaiting HQ approval.';
            for(const row of rows){const card=document.createElement('article');card.style.cssText='border-top:1px solid #e3ebe6;padding:15px 0;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;';
                const detail=document.createElement('div'),name=document.createElement('strong'),info=document.createElement('p');name.textContent=`${row.requesterName} ↔ ${row.targetName}`;info.textContent=`${row.branch} · ${row.workDate||row.dateStr} · ${row.requesterShiftName||row.requesterShiftId} / ${row.targetShiftName||row.targetShiftId}`;info.style.cssText='font-size:12px;color:#6b8175;margin:6px 0;';detail.append(name,info);
                const actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;';for(const action of ['Approve','Reject']){const button=document.createElement('button');button.type='button';button.className='action-btn';button.textContent=action;button.style.cssText=action==='Approve'?'background:#15654f;color:white;':'background:white;color:#a34434;border:1px solid #e7d1c9;';button.onclick=async()=>{
                    if(busy)return;const confirmed=await api.ManagerUI.confirm(`${action} this swap for ${row.branch} on ${row.workDate||row.dateStr}?`);if(!confirmed)return;busy=true;for(const btn of panel.querySelectorAll('button'))btn.disabled=true;
                    try{if(action==='Approve')await approveScheduleSwap(api,row.id);else await rejectScheduleSwap(api,row.id);await refresh();status.textContent=action==='Approve'?'Swap approved and its effective date saved in schedule memory.':'Swap rejected. The schedule was not changed.';}
                    catch(error){status.textContent='Could not '+action.toLowerCase()+' swap: '+error.message;status.style.color='#a34434';}
                    finally{busy=false;for(const btn of panel.querySelectorAll('button'))btn.disabled=false;}
                };actions.append(button);}card.append(detail,actions);list.append(card);}
        }catch(error){if(token===generation){status.textContent='Could not load swap approvals: '+error.message;status.style.color='#a34434';}}
    };
    refreshButton.onclick=refresh;const controller={refresh};api.scheduleSwapReviewUI=controller;return controller;
}
