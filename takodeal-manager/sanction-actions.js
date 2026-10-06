import {canOpenHrTab, OWNER_EMAIL, createWorkspaceSession} from './workspace-access-model.js';
import {resolveHQAccount} from './hq-account-model.js';
import {futureEffectiveDate, phDay, isPenaltyDeduction} from './sanction-schedule.js';

const text=value=>String(value || '').trim();
const validId=value=>{if(typeof value!=='string'||!value||value.includes('/'))throw Error('Select a valid record.');return value;};
const validChangeId=value=>{if(typeof value!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(value))throw Error('Open a new date-change action.');return value;};
const intentOf=input=>JSON.stringify([input.staffId,input.staffName,input.branch,text(input.type),text(input.severity),text(input.details),input.evidencePhoto||'',Number(input.amount)||0,input.deductionType||'Sanction Penalty',input.remarks||input.details,input.effectiveDate]);
const transactionSessions=new WeakMap();
async function authorizedTransaction(api,actor,handler) {
    const snapshots=await (api.getDocsFromServer||api.getDocs)(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email)));
    return api.runTransaction(api.db,async tx=>{
        const records=[];for(const record of snapshots.docs){const snap=await tx.get(api.doc(api.db,'hq_managers',record.id));if(snap.exists())records.push({id:record.id,data:snap.data()});}
        const account=resolveHQAccount(records);if(account.blocked===true)throw Error('Your saved account is blocked. Ask the owner to review its access.');
        const saved=createWorkspaceSession(api.auth.currentUser,account);
        transactionSessions.set(tx,saved);
        try {sameActor(api,actor,null,{},tx);return await handler(tx);} finally {transactionSessions.delete(tx);}
    });
}
export function sanctionAuthority(api, branch, {money=false}={}) {
    const session=api.sessionUser,user=api.auth?.currentUser;
    if(!session || !user?.uid || !user.email || session.uid!==user.uid || text(session.email).toLowerCase()!==text(user.email).toLowerCase() || user.emailVerified===false || !canOpenHrTab(session,'Sanctions') || money&&!canOpenHrTab(session,'Ledger'))throw Error('Your signed-in Google account does not have permission for this action.');
    const all=text(session.email).toLowerCase()===OWNER_EMAIL || session.allowedBranches?.includes('All');
    if(branch && !all && !session.allowedBranches?.includes(branch))throw Error('This branch is outside your assigned access.');
    return {uid:user.uid,email:text(user.email).toLowerCase(),name:session.cashierName || session.fullName || user.email};
}
const sameActor=(api,actor,branch,options,tx)=>{const live=sanctionAuthority(api,branch,options);if(live.uid!==actor.uid||live.email!==actor.email)throw Error('The signed-in account changed. Open the record again.');if(tx)sanctionAuthority({...api,sessionUser:transactionSessions.get(tx)},branch,options);};
const revision=row=>Number(row.scheduleRevision)||0;
const stamp=(api,now)=>api.serverTimestamp?.() || now.toISOString();
function editableMoney(row) {
    if(row.status!=='Unpaid'||row.paidAt||row.payrollRecordId||row.frozenPayrollId||row.payrollSettlementId||row.payrollFrozen===true)throw Error('This deduction is paid or reserved in a saved payroll record. Its date cannot be changed.');
    if(!isPenaltyDeduction(row))throw Error('This date action is for penalty deductions.');
}
export async function findSanctionStaff(api,staffName,branch) {
    sanctionAuthority(api,branch);
    const snap=await (api.getDocsFromServer||api.getDocs)(api.query(api.collection(api.db,'cashiers'),api.where('cashierName','==',staffName)));
    const matches=snap.docs.filter(doc=>(!branch || doc.data().branch===branch) && doc.data().status!=='Resigned' && doc.data().pin!=='REVOKED');
    if(matches.length!==1)throw Error('The exact staff account is missing or duplicated. Review the staff directory first.');
    sanctionAuthority(api,matches[0].data().branch);return {id:matches[0].id,...matches[0].data()};
}
function validateStaff(profile,input) {
    if(!profile || profile.cashierName!==input.staffName || profile.branch!==input.branch || profile.status==='Resigned' || profile.pin==='REVOKED')throw Error('The staff assignment changed. Select the staff member again.');
}
function draftNotice(api,input,actor,date,now,id) {
    const amount=Number(input.amount)||0;
    return {staffName:input.staffName,staffId:input.staffId,branch:input.branch,type:text(input.type),severity:text(input.severity),details:text(input.details),evidencePhoto:input.evidencePhoto || '',issueIntent:intentOf({...input,effectiveDate:date}),status:'Pending Reply',issuedBy:actor.name,issuedByEmail:actor.email,issuedByUid:actor.uid,timestamp:stamp(api,now),issuedAt:stamp(api,now),effectiveDate:date,scheduleRevision:1,...(amount>0?{deductionId:'sanction-'+id}:{}),scheduleAudit:{issued:{oldDate:null,newDate:date,reason:'Notice issued',actorEmail:actor.email,actorUid:actor.uid,at:stamp(api,now)}}};
}
function draftDeduction(api,input,actor,date,now,id) {
    return {staffName:input.staffName,staffId:input.staffId,branch:input.branch,type:input.deductionType || 'Sanction Penalty',amount:Number(input.amount),dateAdded:stamp(api,now),issuedAt:stamp(api,now),effectiveDate:date,status:'Unpaid',sanctionId:id,scheduleVersion:1,scheduleRevision:1,remarks:input.remarks || input.details,scheduleAudit:{issued:{oldDate:null,newDate:date,reason:'Penalty issued',actorEmail:actor.email,actorUid:actor.uid,at:stamp(api,now)}}};
}
export async function issueScheduledSanction(api,input,{id,now=()=>new Date()}={}) {
    validId(id);const at=now(),date=futureEffectiveDate(input.effectiveDate || phDay(at),at),money=Number(input.amount)>0,actor=sanctionAuthority(api,input.branch,{money});
    if(!text(input.staffName)||!text(input.branch)||!text(input.type)||!text(input.severity)||!text(input.details)||!input.staffId)throw Error('Complete the staff, incident, severity and details.');
    if(!Number.isFinite(Number(input.amount || 0))||Number(input.amount)<0)throw Error('Enter a valid penalty amount.');
    return authorizedTransaction(api,actor,async tx=>{
        const noticeRef=api.doc(api.db,'hr_sanctions',id),staffRef=api.doc(api.db,'cashiers',validId(input.staffId)),deductionRef=api.doc(api.db,'staff_deductions','sanction-'+id);
        const existing=await tx.get(noticeRef),profile=await tx.get(staffRef),deduction=money?await tx.get(deductionRef):null;
        sameActor(api,actor,input.branch,{money},tx);validateStaff(profile.exists()?profile.data():null,input);
        if(existing.exists()) {const row=existing.data();if(row.issuedByUid===actor.uid&&row.issueIntent===intentOf({...input,effectiveDate:date}))return {id,alreadySaved:true};throw Error('The notice reference belongs to different details or a different penalty amount. Open a new notice.');}
        if(deduction?.exists())throw Error('The penalty reference is already in use.');
        tx.set(noticeRef,draftNotice(api,input,actor,date,at,id));if(money)tx.set(deductionRef,draftDeduction(api,input,actor,date,at,id));
        return {id,deductionId:money?'sanction-'+id:null,effectiveDate:date};
    });
}
export async function rescheduleSanction(api,id,input,{now=()=>new Date()}={}) {
    validId(id);validChangeId(input.changeId);const actor=sanctionAuthority(api),date=futureEffectiveDate(input.effectiveDate,now()),reason=text(input.reason);if(reason.length<5)throw Error('Explain why the date is changing.');
    return authorizedTransaction(api,actor,async tx=>{
        const ref=api.doc(api.db,'hr_sanctions',id),snap=await tx.get(ref);if(!snap.exists())throw Error('This notice no longer exists.');const row=snap.data();
        const deductionRef=row.deductionId?api.doc(api.db,'staff_deductions',validId(row.deductionId)):null,deduction=deductionRef?await tx.get(deductionRef):null;
        sameActor(api,actor,row.branch,{money:!!deductionRef},tx);
        const previous=row.scheduleAudit?.[input.changeId];if(previous){if(previous.newDate===date&&previous.reason===reason&&previous.actorUid===actor.uid)return {alreadySaved:true,effectiveDate:date};throw Error('This date change reference is already used.');}
        if(revision(row)!==Number(input.expectedRevision))throw Error('This notice changed while you were reviewing it. Refresh and try again.');
        if(['Archived','Resolved','Closed','Cancelled','Canceled','Deleted'].includes(row.status))throw Error('A finished notice cannot be rescheduled. Change an unpaid penalty separately in the ledger.');
        if(deductionRef && !deduction.exists())throw Error('The linked penalty is missing. Review the ledger before changing this date.');
        if(deduction){const d=deduction.data();editableMoney(d);if(d.sanctionId!==id||d.staffName!==row.staffName||d.branch!==row.branch)throw Error('The linked penalty does not match this notice.');}
        const audit={oldDate:row.effectiveDate || null,newDate:date,reason,actorEmail:actor.email,actorUid:actor.uid,at:stamp(api,now())};
        tx.update(ref,{effectiveDate:date,scheduleRevision:revision(row)+1,scheduleAudit:{...(row.scheduleAudit || {}),[input.changeId]:audit}});
        if(deduction)tx.update(deductionRef,{effectiveDate:date,scheduleVersion:1,scheduleRevision:revision(deduction.data())+1,scheduleAudit:{...(deduction.data().scheduleAudit || {}),[input.changeId]:{...audit,oldDate:deduction.data().effectiveDate || null}}});
        return {effectiveDate:date,revision:revision(row)+1};
    });
}
export async function reschedulePenalty(api,id,input,{now=()=>new Date()}={}) {
    validId(id);validChangeId(input.changeId);const actor=sanctionAuthority(api,null,{money:true}),date=futureEffectiveDate(input.effectiveDate,now()),reason=text(input.reason);if(reason.length<5)throw Error('Explain why the penalty date is changing.');
    const read=api.getDocFromServer||api.getDoc,original=await read(api.doc(api.db,'staff_deductions',id));if(!original.exists())throw Error('This penalty no longer exists.');const originalRow=original.data();
    if(originalRow.sanctionId){const notice=await read(api.doc(api.db,'hr_sanctions',validId(originalRow.sanctionId)));if(!notice.exists())throw Error('The linked notice is missing.');if(!['Archived','Resolved','Closed','Cancelled','Canceled','Deleted'].includes(notice.data().status))return rescheduleSanction(api,originalRow.sanctionId,{...input,expectedRevision:input.noticeRevision ?? revision(notice.data())},{now});}
    let profile;
    if(!originalRow.branch){const rows=await (api.getDocsFromServer||api.getDocs)(api.query(api.collection(api.db,'cashiers'),api.where('cashierName','==',originalRow.staffName)));if(rows.docs.length!==1)throw Error('Review this legacy penalty’s staff account and branch first.');profile={id:rows.docs[0].id,...rows.docs[0].data()};}
    return authorizedTransaction(api,actor,async tx=>{
        const ref=api.doc(api.db,'staff_deductions',id),snap=await tx.get(ref);if(!snap.exists())throw Error('This penalty no longer exists.');const row=snap.data(),linked=row.sanctionId?await tx.get(api.doc(api.db,'hr_sanctions',validId(row.sanctionId))):null,staff=profile?await tx.get(api.doc(api.db,'cashiers',profile.id)):null,branch=row.branch || staff?.data()?.branch;
        if(linked && (!linked.exists() || linked.data().staffName!==row.staffName || linked.data().branch!==branch || !['Archived','Resolved','Closed','Cancelled','Canceled','Deleted'].includes(linked.data().status)))throw Error('The linked notice changed. Open the penalty again.');
        if(!branch||profile&&(!staff.exists()||staff.data().cashierName!==row.staffName))throw Error('The staff assignment changed. Review the penalty again.');sameActor(api,actor,branch,{money:true},tx);
        const previous=row.scheduleAudit?.[input.changeId];if(previous){if(previous.newDate===date&&previous.reason===reason&&previous.actorUid===actor.uid)return {alreadySaved:true,effectiveDate:date};throw Error('This date change reference is already used.');}
        editableMoney(row);if(revision(row)!==Number(input.expectedRevision))throw Error('This penalty changed while you were reviewing it.');
        tx.update(ref,{effectiveDate:date,scheduleVersion:1,scheduleRevision:revision(row)+1,scheduleAudit:{...(row.scheduleAudit || {}),[input.changeId]:{oldDate:row.effectiveDate || null,newDate:date,reason,actorEmail:actor.email,actorUid:actor.uid,at:stamp(api,now())}}});return {effectiveDate:date};
    });
}
export async function issueHandoverSanctions(api,input,{now=()=>new Date()}={}) {
    const actor=sanctionAuthority(api,input.branch,{money:true}),at=now(),date=futureEffectiveDate(input.effectiveDate,at),names=[...new Set(input.staffNames.map(text).filter(Boolean))];
    if(!input.shiftId||!names.length||names.length>20||!Number.isFinite(Number(input.totalLoss))||Number(input.totalLoss)<=0)throw Error('Review the shift and shortage amount first.');
    const profiles=await Promise.all(names.map(name=>findSanctionStaff(api,name,input.branch))),totalCents=Math.round(Number(input.totalLoss)*100),baseCents=Math.floor(totalCents/names.length);
    return authorizedTransaction(api,actor,async tx=>{
        const shiftRef=api.doc(api.db,'shifts',validId(input.shiftId)),shift=await tx.get(shiftRef),refs=profiles.map(p=>({profile:p,notice:api.doc(api.db,'hr_sanctions','handover-'+input.shiftId+'-'+p.id),deduction:api.doc(api.db,'staff_deductions','sanction-handover-'+input.shiftId+'-'+p.id)}));
        const staffSnaps=[],existing=[];for(const entry of refs){staffSnaps.push(await tx.get(api.doc(api.db,'cashiers',entry.profile.id)));existing.push(await tx.get(entry.notice),await tx.get(entry.deduction));}
        sameActor(api,actor,input.branch,{money:true},tx);if(!shift.exists()||shift.data().branch!==input.branch)throw Error('The shift is missing or outside this branch.');if(shift.data().penaltyApplied)return {alreadySaved:true};if(existing.some(snap=>snap.exists()))throw Error('A linked handover record already exists without its shift marker. Review it before issuing another penalty.');
        for(let i=0;i<refs.length;i++){const amount=(baseCents+(i<totalCents%names.length?1:0))/100,entry=refs[i],id=entry.notice.id||'handover-'+input.shiftId+'-'+entry.profile.id,data={staffId:entry.profile.id,staffName:entry.profile.cashierName,branch:input.branch,type:'Cash/Stock Shortage',severity:'Written Warning & Deduction',details:'Inventory count mismatch: ₱'+amount.toFixed(2)+' per person.',remarks:'Shift Handover Audit Shortage. Shift ID: '+input.shiftId,amount,deductionType:'Inventory Shortage Penalty'};validateStaff(staffSnaps[i].exists()?staffSnaps[i].data():null,data);tx.set(entry.notice,draftNotice(api,data,actor,date,at,id));tx.set(entry.deduction,draftDeduction(api,data,actor,date,at,id));}
        tx.update(shiftRef,{penaltyApplied:true,penaltyEffectiveDate:date,penaltyIssuedAt:stamp(api,at)});
        return {effectiveDate:date,count:names.length};
    });
}
export async function finishSanction(api,id,{cancel=false,changeId,now=()=>new Date()}={}) {
    validId(id);validChangeId(changeId);const actor=sanctionAuthority(api);
    return authorizedTransaction(api,actor,async tx=>{
        const ref=api.doc(api.db,'hr_sanctions',id),snap=await tx.get(ref);if(!snap.exists())throw Error('This notice no longer exists.');const row=snap.data();sameActor(api,actor,row.branch,{},tx);
        if(row.statusAudit?.[changeId])return {alreadySaved:true};
        if(['Archived','Cancelled','Canceled','Deleted'].includes(row.status))return {alreadySaved:true};
        const status=cancel?(['Resolved','Closed'].includes(row.status)?'Archived':'Cancelled'):'Resolved';
        tx.update(ref,{status,...(cancel?{cancelledAt:stamp(api,now()),cancelledBy:actor.email}:{resolvedAt:stamp(api,now()),resolvedBy:actor.email}),statusAudit:{...(row.statusAudit || {}),[changeId]:{oldStatus:row.status,newStatus:status,actorUid:actor.uid,actorEmail:actor.email,at:stamp(api,now())}}});return {status};
    });
}
