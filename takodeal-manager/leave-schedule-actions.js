import {canOpenWorkspacePage} from './workspace-access-model.js';
import {createScheduleRevision,assembleScheduleHistory,resolveScheduleForDate,monthKey,scheduleDateKey} from './schedule-history.js';
import {projectScheduleMonth} from './schedule-sync.js';
import {readPayrollSnapshot} from './payroll-preview-guard.js';
import {attendanceKind,attendanceMillis,belongsToAttendance} from './attendance-reconcile.js';
import {leaveNameKey,leavePerson,leaveFingerprint,leaveDates,leaveToday,activeLeaveDates,proposedLeaveDates,projectLeaveDay} from './leave-model.js';
const copy=value=>JSON.parse(JSON.stringify(value)),data=snapshot=>snapshot?.exists?.()?snapshot.data():null;
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const fields=['branchConfig','employees','unavailability','currentSchedule','currentYear','currentMonth','holidays'];
const snap=value=>Object.fromEntries(fields.filter(key=>value?.[key]!==undefined).map(key=>[key,copy(value[key])]));
export function canReviewLeave(api,branch){
 const actor=api.auth?.currentUser,user=api.sessionUser;
 if(!actor?.uid||!actor.email||actor.emailVerified===false||user?.uid!==actor.uid||String(user.email||'').trim().toLowerCase()!==actor.email.trim().toLowerCase()||!canOpenWorkspacePage(user,'inbox')||!canOpenWorkspacePage(user,'schedule'))return false;
 if(!branch)return true;const allowed=api.isBranchAllowed?api.isBranchAllowed(branch)===true:user.isOwner===true||(user.allowedBranches||[]).includes('All')||(user.allowedBranches||[]).includes(branch);
 return allowed&&(!user.isFranchisee||(user.allowedBranches||[user.branch]).includes(branch));
}
export function createLeaveScheduleService(api,{now=()=>new Date(),timeoutMs=25000}={}){
 const ref=(table,id)=>api.doc(api.db,table,id),settings=id=>ref('settings',id),monthId=month=>'schedule_month_'+month.replace('-','_'),revisionId=id=>'schedule_revision_'+id,pending=new Map();
 const account=()=>leaveFingerprint([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.role,api.sessionUser?.isOwner,api.sessionUser?.isFranchisee,api.sessionUser?.permissions,api.sessionUser?.allowedBranches,api.sessionUser?.branch,api.sessionUser?.assignedBranch]);
 function guard(key,branch){if(key!==account()||!canReviewLeave(api,branch))throw Error('Sign in with approved Request Inbox and Schedule Manager access for every affected branch.');}
 async function readDoc(reference){if(typeof api.getDocFromServer!=='function')throw Error('Connect to HQ to confirm the saved leave.');let timer;try{const result=await Promise.race([api.getDocFromServer(reference),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Connect to HQ and refresh the leave request.')),timeoutMs);})]);if(result?.metadata?.fromCache===true||result?.metadata?.hasPendingWrites===true)throw Error('Connect to HQ and refresh the leave request.');return result;}finally{clearTimeout(timer);}}
 async function readRows(table,clauses=[]){const q=api.query(api.collection(api.db,table),...clauses,...(api.limit?[api.limit(2001)]:[])),snapshot=await readPayrollSnapshot(api,q,{timeoutMs});if(snapshot.docs.length>2000)throw Error('Too many records need verification. Ask HQ to review this leave separately.');return snapshot.docs.map(doc=>({...doc.data(),id:doc.id}));}
 function run(id,intent,work){if(pending.has(id)){if(pending.get(id).intent!==intent)throw Error('This review is still pending with different details. Wait for confirmation and reopen it.');return pending.get(id).visible;}let timer;const physical=work(),entry={intent};entry.visible=Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ is still confirming this decision. Retry this same review after reconnecting.')),timeoutMs);})]).finally(()=>clearTimeout(timer));pending.set(id,entry);const clear=()=>{if(pending.get(id)===entry)pending.delete(id);};physical.then(clear,clear);return entry.visible;}

 function reviewPlan(parent,request,input,mode,today){
  const before=activeLeaveDates(parent);
  if(mode==='reject')return {before,after:before,removed:[],added:[]};
  if(mode==='change'){
   const touchesPast=input.kind==='Dates'?String(input.startDate||'')<today:(input.cancelDates||[]).some(date=>date<today);
   return proposedLeaveDates(parent,input,today,{historical:input.confirmHistorical===true||touchesPast});
  }
  if(request.type!=='Leave Change')return {before,after:before,removed:[],added:before};
  let submitted;try{submitted=scheduleDateKey(request.timestamp);if(submitted<'2000-01-01'||submitted>today)throw Error('Invalid submission date');}
  catch{throw Error('The saved leave-change submission date is missing or invalid. Reject this pending change, then open the original approved leave and use Change leave dates with a management note.');}
  const plan=proposedLeaveDates(parent,{kind:request.changeKind,cancelDates:request.cancelDates,startDate:request.proposedStartDate,endDate:request.proposedEndDate},submitted);
  if(leaveFingerprint(plan.after)!==leaveFingerprint(request.requestedActiveDates))throw Error('The proposed leave dates are inconsistent. Ask staff to send a fresh change request.');
  return plan;
 }
 function plannedDates(plan,mode,parent,input,today){
  const synced=parent.leaveScheduleSync?.version===1;
  let activate=mode==='sync'&&synced?plan.after.filter(date=>(parent.leaveScheduleSync.skippedHistoricalDates||[]).includes(date)):mode==='sync'||!synced?plan.after:plan.added;
  let remove=plan.removed;
  if(mode==='sync'&&input.confirmHistorical!==true){activate=activate.filter(date=>date>=today);remove=remove.filter(date=>date>=today);}
  return {activate,remove,affected:[...new Set([...activate,...remove])].sort()};
 }
 function punchDate(row,rows,person){
  const kind=attendanceKind(row),stamp=attendanceMillis(row.timestamp);
  if(!Number.isFinite(stamp))throw Error('An attendance date could not be verified. Review this staff member’s attendance before changing leave.');
  if(kind==='TIME OUT'&&row.timeInLogId){
   const linked=rows.get(row.timeInLogId);if(!linked||attendanceKind(linked)!=='TIME IN'||!belongsToAttendance(linked,person.staffId,person.aliases))throw Error('A Time Out has an unverified linked Time In. Review attendance before changing leave.');
   const started=attendanceMillis(linked.timestamp);if(!Number.isFinite(started)||stamp<started||stamp-started>24*60*60*1000||row.branch&&linked.branch&&row.branch!==linked.branch)throw Error('A Time Out has a conflicting linked shift. Review attendance before changing leave.');
   return punchDate(linked,rows,person);
  }
  const start=row.scheduleSnapshot?.expectedStartAt||row.scheduleSnapshot?.workDate||row.workDate;
  if(start)return scheduleDateKey(start);
  if(kind==='TIME OUT'){
   const candidates=[...rows.values()].filter(item=>attendanceKind(item)==='TIME IN'&&belongsToAttendance(item,person.staffId,person.aliases)&&(!row.branch||!item.branch||row.branch===item.branch)&&attendanceMillis(item.timestamp)<=stamp&&stamp-attendanceMillis(item.timestamp)<=18*60*60*1000).sort((a,b)=>attendanceMillis(b.timestamp)-attendanceMillis(a.timestamp));
   if(candidates.length&&(!candidates[1]||attendanceMillis(candidates[0].timestamp)!==attendanceMillis(candidates[1].timestamp)))return punchDate(candidates[0],rows,person);
  }
  return scheduleDateKey(row.timestamp);
 }
 async function prepare(input,mode){
  const key=account();guard(key);if(!validId(input.requestId)||!validId(input.operationId)||input.operationId.length>80)throw Error('Reopen the leave review.');
  const original=data(await readDoc(ref('staff_requests',input.requestId)));guard(key);if(!original||!['Leave','Leave Change'].includes(original.type))throw Error('This leave request no longer exists.');
  const parentId=original.type==='Leave Change'?original.leaveRequestId:input.requestId;if(!validId(parentId))throw Error('The original approved leave reference is missing.');
  const parent=parentId===input.requestId?original:data(await readDoc(ref('staff_requests',parentId)));guard(key);if(!parent||parent.type!=='Leave')throw Error('The original leave is missing.');
  const people=await readRows('cashiers');guard(key);const matches=parent.staffId?people.filter(row=>row.id===parent.staffId):people.filter(row=>leaveNameKey(row.cashierName)===leaveNameKey(parent.staffName));
  if(matches.length!==1)throw Error('The staff identity is missing or duplicated. Check the saved staff profile before approving leave.');const profile=matches[0],person=leavePerson(profile,profile.id);
  if(parent.staffId&&parent.staffName&&!person.aliases.some(name=>leaveNameKey(name)===leaveNameKey(parent.staffName)))person.aliases.push(String(parent.staffName));
  if(people.some(row=>row.id!==person.staffId&&[row.cashierName,row.fullName,row.scheduleNickname,row.scheduleName,row.nickname].some(name=>name&&person.aliases.some(alias=>leaveNameKey(alias)===leaveNameKey(name)))))throw Error('This schedule name belongs to more than one staff profile. Ask HQ to confirm the identity.');
  if(parent.branch&&parent.branch!==person.branch)throw Error('The saved request branch differs from the current staff profile. Ask HQ to review the transfer.');guard(key,person.branch);
  const today=leaveToday(now());
  // Recover a committed transition before rebuilding a proposal from its now-updated parent.
  // The transaction below still rechecks the actor, fresh parent and exact saved intent.
  if((parent.leaveActions||[]).some(action=>action.id===input.operationId))return {key,original,parent,parentId,profile,person,today,target:null,affected:[],otherLeaves:[],payroll:[],punches:[]};
  const target=reviewPlan(parent,original,input,mode,today);
  if(!Array.isArray(target.after))throw Error('The proposed leave dates need review.');target.after.forEach(scheduleDateKey);
  const {affected}=plannedDates(target,mode,parent,input,today);
  const grouped=new Map();for(const name of person.aliases){const rows=await readRows('staff_requests',[api.where('staffName','==',name)]);guard(key,person.branch);for(const row of rows)if(row.type==='Leave')grouped.set(row.id,row);}
  const byId=await readRows('staff_requests',[api.where('staffId','==',person.staffId)]);guard(key,person.branch);for(const row of byId)if(row.type==='Leave')grouped.set(row.id,row);
  const payroll=[];for(const [field,value]of [['staffId',person.staffId],...person.aliases.map(name=>['staffName',name])]){payroll.push(...await readRows('payroll_records',[api.where(field,'==',value)]));guard(key,person.branch);}
  const punches=[];if(affected.some(date=>date<=today))for(const [field,value]of [['staffId',person.staffId],...person.aliases.map(name=>['staffName',name])]){punches.push(...await readRows('attendance_logs',[api.where(field,'==',value)]));guard(key,person.branch);}
  return {key,original,parent,parentId,profile,person,today,target,affected,otherLeaves:[...grouped.values()],payroll:[...new Map(payroll.map(row=>[row.id,row])).values()],punches:[...new Map(punches.map(row=>[row.id,row])).values()].filter(row=>{const days=new Set(affected);for(const day of affected){const next=new Date(day+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);days.add(next.toISOString().slice(0,10));}try{if(days.has(scheduleDateKey(row.timestamp)))return true;const expected=row.scheduleSnapshot?.expectedStartAt||row.scheduleSnapshot?.workDate||row.workDate;return expected?affected.includes(scheduleDateKey(expected)):false;}catch{return true;}})};
 }
 async function decide(input,mode){
  const prepared=await prepare(input,mode),{key,person,today,parentId}=prepared,at=now().toISOString(),reply=String(input.reply||input.reason||'').trim();if(reply.length>1500)throw Error('Keep the review note under 1,500 characters.');
  const intent=leaveFingerprint({mode,requestId:input.requestId,operationId:input.operationId,action:input.action||'',kind:input.kind||'',cancelDates:input.cancelDates||null,startDate:input.startDate||'',endDate:input.endDate||'',reply,...(input.confirmHistorical===true?{confirmHistorical:true}:{})});
  return run(key+'|'+input.operationId,intent,()=>api.runTransaction(api.db,async tx=>{
   const reads=new Map(),get=async reference=>{guard(key,person.branch);if(!reads.has(reference.path||reference))reads.set(reference.path||reference,tx.get(reference).then(data));const value=await reads.get(reference.path||reference);guard(key,person.branch);return value;};guard(key,person.branch);
   const requestRef=ref('staff_requests',input.requestId),parentRef=ref('staff_requests',parentId),claimRef=settings('schedule_leave_staff_'+person.staffId);
   const [request,parent,profile,current,policy,claims]=await Promise.all([get(requestRef),get(parentRef),get(ref('cashiers',person.staffId)),get(settings('global_schedule')),get(settings('schedule_history_policy')),get(claimRef)]);guard(key,person.branch);
   const freshPerson=leavePerson(profile,person.staffId),originalPerson=leavePerson(prepared.profile,person.staffId);if(leaveFingerprint(freshPerson)!==leaveFingerprint(originalPerson))throw Error('The staff profile changed while this leave was being reviewed. Reopen it.');
   if(!request||!parent)throw Error('This leave request changed or was removed.');const prior=(parent.leaveActions||[]).find(row=>row.id===input.operationId);
   if(prior){if(prior.intent!==intent)throw Error('This review reference has different saved details.');return {alreadySaved:true,status:request.status,changedDates:prior.changedDates||[],historicalDates:prior.historicalDates||[],skippedHistoricalDates:prior.skippedHistoricalDates||[]};}
   if(mode==='approve'&&request.status==='Approved'&&request.type==='Leave'&&request.leaveScheduleSync?.version===1)return {alreadySaved:true,status:'Approved',changedDates:[]};
   if(mode==='reject'&&request.status==='Rejected')return {alreadySaved:true,status:'Rejected',changedDates:[]};
   if(leaveFingerprint(request)!==leaveFingerprint(prepared.original)||leaveFingerprint(parent)!==leaveFingerprint(prepared.parent))throw Error('The leave request changed during review. Refresh it before confirming.');
   if(mode==='sync'){if(parent.status!=='Approved')throw Error('Only approved leave can be explicitly synced.');if(parent.leaveScheduleSync?.version===1&&!(input.confirmHistorical===true&&parent.leaveScheduleSync.skippedHistoricalDates?.length))return {alreadySaved:true,status:'Approved',changedDates:[]};}
   else if(mode==='change'){if(parent.status!=='Approved'||request.type!=='Leave')throw Error('Select an approved leave to change.');if(parent.pendingLeaveChangeId)throw Error('A staff change is already awaiting review. Review that request first.');}
   else if(request.status!=='Pending')throw Error('This request is no longer pending. Refresh the inbox.');
   if(mode==='reject'){
    const decision={id:input.operationId,intent,kind:'Rejected',requestId:input.requestId,at,actor:{uid:api.auth.currentUser.uid,email:api.auth.currentUser.email},changedDates:[]};guard(key,person.branch);
    tx.set(requestRef,{...request,status:'Rejected',managerReply:reply,processedAt:api.serverTimestamp?.()||at,processedBy:api.sessionUser.cashierName||api.auth.currentUser.email,processedUid:api.auth.currentUser.uid,staffAcknowledged:false});
    if(parentId!==input.requestId)tx.set(parentRef,{...parent,pendingLeaveChangeId:parent.pendingLeaveChangeId===input.requestId?null:parent.pendingLeaveChangeId,leaveActions:[...(parent.leaveActions||[]),decision]});else tx.set(parentRef,{...request,status:'Rejected',managerReply:reply,processedAt:api.serverTimestamp?.()||at,processedBy:api.sessionUser.cashierName||api.auth.currentUser.email,processedUid:api.auth.currentUser.uid,staffAcknowledged:false,leaveActions:[...(parent.leaveActions||[]),decision]});return {status:'Rejected',changedDates:[],alreadySaved:false};
   }
   if(request.type==='Leave Change'&&(parent.status!=='Approved'||Number(request.sourceLeaveVersion||0)!==Number(parent.leaveVersion||0)||leaveFingerprint(request.sourceActiveDates)!==leaveFingerprint(activeLeaveDates(parent))))throw Error('The original approved leave changed. Ask staff to send a fresh change request.');
   const before=activeLeaveDates(parent),plan=reviewPlan(parent,request,input,mode,today);
   if(plan.after.some(date=>scheduleDateKey(date)!==date)||plan.after.length>186)throw Error('The proposed leave dates need review.');
   const {activate,remove,affected}=plannedDates(plan,mode,parent,input,today),historicalDates=affected.filter(date=>date<today);
   if(historicalDates.length&&(input.confirmHistorical!==true||reply.length<3))throw Error('Confirm the late review and add a management note before updating earlier leave dates.');
   if(!affected.length&&mode==='sync')throw Error('No remaining leave dates need schedule sync. Earlier attendance and paid payslips stay on file.');
   for(const proof of prepared.otherLeaves){const row=await get(ref('staff_requests',proof.id));if(row?.id===parentId||proof.id===parentId||row?.status!=='Approved')continue;if(row.staffId&&row.staffId!==person.staffId||!row.staffId&&!person.aliases.some(name=>leaveNameKey(name)===leaveNameKey(row.staffName)))continue;if(activeLeaveDates(row).some(date=>activate.includes(date)))throw Error('Another approved leave overlaps these dates. Review it before approving a second leave.');}
   for(const proof of prepared.payroll){const row=await get(ref('payroll_records',proof.id));if(row?.frozenData&&(!row.staffId||row.staffId===person.staffId)&&affected.some(date=>row.startDate<=date&&row.endDate>=date))throw Error('A paid payslip covers an affected date. That saved schedule and payroll stay unchanged.');}
   if(affected.some(date=>date<=today)){
    const rows=new Map();for(const proof of prepared.punches){const row=await get(ref('attendance_logs',proof.id));if(row&&!row.deleted&&!['Voided','Cancelled'].includes(row.status)&&belongsToAttendance(row,person.staffId,person.aliases))rows.set(proof.id,{...row,id:proof.id});}
    for(const row of [...rows.values()])if(row.timeInLogId&&!rows.has(row.timeInLogId)){if(!validId(row.timeInLogId))throw Error('An attendance link needs HR review.');const linked=await get(ref('attendance_logs',row.timeInLogId));if(linked&&!linked.deleted&&!['Voided','Cancelled'].includes(linked.status))rows.set(row.timeInLogId,{...linked,id:row.timeInLogId});}
    for(const row of rows.values()){const date=punchDate(row,rows,person);if(affected.includes(date))throw Error(date+': this staff member already has recorded work. Review Time In / Time Out in HR before changing leave; no punches were changed.');}
   }
   const claimed=copy(claims?.dates||{});for(const date of activate){if(claimed[date]&&claimed[date].requestId!==parentId)throw Error('Another approved leave owns '+date+'. Refresh before confirming.');claimed[date]={requestId:parentId,staffId:person.staffId};}for(const date of remove)if(claimed[date]?.requestId===parentId)delete claimed[date];
   const months=[...new Set(affected.map(date=>date.slice(0,7)))],indices=new Map(),archives=new Map(),monthSnapshots=new Map(),effects=[],revisions=[],historicalBases=new Map(),historicalProjections=new Map();let currentHead=null;
   for(const month of months){
    const index=await get(settings(monthId(month))),ids=index?.revisionIds||[];if(!Array.isArray(ids)||index?.latestRevisionId&&!ids.includes(index.latestRevisionId))throw Error('The saved schedule index is incomplete. Refresh Schedule Manager.');
    const saved=[];for(const id of ids){const row=await get(settings(revisionId(id)));if(!row||row.month!==month||row.revisionId!==id||!row.snapshot)throw Error('A saved schedule version is missing. Ask HQ to review schedule memory.');saved.push(row);}
    const durable=await get(settings('schedule_shift_amendments_'+month.replace('-','_'))),amendments=durable?.shiftAmendments||index?.shiftAmendments||[];
    if(!Array.isArray(amendments)||durable&&index?.shiftAmendments?.some((row,i)=>leaveFingerprint(row)!==leaveFingerprint(amendments[i])))throw Error('Saved shift correction history needs review.');
    const archive={month,revisions:saved,latestRevisionId:index?.latestRevisionId||null,latestRevision:saved.find(row=>row.revisionId===index?.latestRevisionId)||null,shiftAmendments:amendments};archives.set(month,archive);indices.set(month,{...(index||{}),...(amendments.length?{shiftAmendments:copy(amendments)}:{})});
    let projected;if(saved.length||current&&monthKey(current)===month)projected=projectScheduleMonth({month,current,archive,now:now()});
    else{const base=current?snap(current):{branchConfig:{},employees:[],unavailability:{},holidays:{}};base.currentYear=Number(month.slice(0,4));base.currentMonth=Number(month.slice(5));base.currentSchedule={};base.unavailability=Object.fromEntries(Object.entries(base.unavailability||{}).filter(([date])=>date.slice(0,7)===month));base.holidays=Object.fromEntries(Object.entries(base.holidays||{}).filter(([date])=>date.slice(0,7)===month));projected={editorSnapshot:base,daySnapshots:{}};}
    const editor=snap(projected.editorSnapshot);editor.currentSchedule||={};editor.unavailability||={};
    for(const date of affected.filter(date=>date.slice(0,7)===month)){
     const basis=date<today?resolveScheduleForDate(assembleScheduleHistory(current,[archive]),date):null;
     if(date<today&&!basis)throw Error(date+': the original dated schedule is not saved. Review this work date in Schedule Manager before applying historical leave; current shift rules were not substituted.');
     if(basis)historicalBases.set(date,basis);
     const original=basis||projected.daySnapshots[Number(date.slice(-2))]||{...copy(editor),currentSchedule:{[Number(date.slice(-2))]:copy(editor.currentSchedule[Number(date.slice(-2))]||{})}},planned=projectLeaveDay(original,date,{person,requestId:parentId,status:parent.leaveType||'Leave',activate:activate.includes(date),assertBranch:branch=>{guard(key,branch);return true;}});
     if(date<today)historicalProjections.set(date,snap(planned.snapshot));
     editor.currentSchedule[Number(date.slice(-2))]=copy(planned.snapshot.currentSchedule[Number(date.slice(-2))]);if(planned.snapshot.unavailability[date])editor.unavailability[date]=copy(planned.snapshot.unavailability[date]);else delete editor.unavailability[date];effects.push(planned.effect);
     monthSnapshots.set(date,{...snap(planned.snapshot),currentSchedule:editor.currentSchedule,unavailability:editor.unavailability});
    }
    // Each work date retains its own configured rules. A one-day revision cannot
    // overwrite a separately planned future rule or any earlier assignment.
    for(const date of affected.filter(date=>date.slice(0,7)===month)){const id=input.operationId+'-'+date.replaceAll('-',''),snapshot=date<today?copy(historicalProjections.get(date)):{...copy(monthSnapshots.get(date)),currentSchedule:copy(editor.currentSchedule),unavailability:copy(editor.unavailability)},revision=createScheduleRevision(snapshot,{revisionId:id,effectiveFrom:date,effectiveTo:date,savedAt:at,actor:api.auth.currentUser.email,source:'approved-leave',cutover:policy?.payrollHistoryEnforcedFrom||current?.payrollHistoryEnforcedFrom||today,...(date<today?{historicalLeaveReview:{basis:historicalBases.get(date),staffId:person.staffId,staffNames:[...new Map(person.aliases.map(name=>[leaveNameKey(name),name])).values()],requestId:parentId,operationId:input.operationId,reason:reply}}:{})});revision.sequence=(indices.get(month).revisionIds?.length||0)+revisions.filter(row=>row.month===month).length+1;revisions.push(revision);}
    if(current&&monthKey(current)===month&&month===today.slice(0,7)){
     const combined={...snap(current),currentSchedule:copy(current.currentSchedule||{}),unavailability:copy(current.unavailability||{})};for(const date of affected.filter(date=>date.slice(0,7)===month)){combined.currentSchedule[Number(date.slice(-2))]=copy(editor.currentSchedule[Number(date.slice(-2))]);if(editor.unavailability[date])combined.unavailability[date]=copy(editor.unavailability[date]);else delete combined.unavailability[date];}
     const id=input.operationId+'-head',revision=createScheduleRevision(combined,{revisionId:id,effectiveFrom:today,effectiveTo:today,savedAt:at,actor:api.auth.currentUser.email,source:'approved-leave-head',cutover:policy?.payrollHistoryEnforcedFrom||current.payrollHistoryEnforcedFrom||today});revision.sequence=(indices.get(month).revisionIds?.length||0)+revisions.filter(row=>row.month===month).length+1;revisions.push(revision);currentHead=revision;
    }
    // A current head publish must not replace the editor's explicitly planned
    // future rules. Preserve that plan as the latest full-month editor version.
    if(archive.latestRevision?.effectiveFrom>today){
     const id=input.operationId+'-plan-'+month.replace('-',''),revision=createScheduleRevision(editor,{revisionId:id,effectiveFrom:archive.latestRevision.effectiveFrom,effectiveTo:archive.latestRevision.effectiveTo,savedAt:at,actor:api.auth.currentUser.email,source:'approved-leave-plan',cutover:policy?.payrollHistoryEnforcedFrom||current?.payrollHistoryEnforcedFrom||today});revision.sequence=(indices.get(month).revisionIds?.length||0)+revisions.filter(row=>row.month===month).length+1;revisions.push(revision);
    }
   }
   for(const revision of revisions){if(await get(settings(revisionId(revision.revisionId))))throw Error('This schedule review reference already exists. Reopen the leave review.');const index=indices.get(revision.month);index.schemaVersion=1;index.kind='schedule-month';index.month=revision.month;index.revisionIds=[...new Set([...(index.revisionIds||[]),revision.revisionId])];index.latestRevisionId=revision.revisionId;index.updatedAt=at;index.payrollHistoryEnforcedFrom||=revision.payrollHistoryEnforcedFrom;}
   // A one-day historical review is an overlay, not a replacement for the
   // complete editor plan. Keeping that pointer also protects older deployed
   // proposal readers when the canonical head has not rolled to this month.
   for(const [month,index]of indices){const added=revisions.filter(row=>row.month===month),prior=archives.get(month)?.latestRevisionId;if(prior&&added.length&&added.every(row=>row.historicalLeaveReview))index.latestRevisionId=prior;}
   const actor={uid:api.auth.currentUser.uid,email:api.auth.currentUser.email},skippedHistoricalDates=plan.after.filter(date=>date<today&&!affected.includes(date)&&(parent.leaveScheduleSync?.version!==1||(parent.leaveScheduleSync.skippedHistoricalDates||[]).includes(date))),decision={id:input.operationId,intent,kind:mode==='sync'?'Schedule sync':request.type==='Leave Change'?request.changeKind:mode==='change'?input.kind:'Approved',requestId:input.requestId,at,actor,changedDates:affected,historicalDates,lateReviewConfirmed:input.confirmHistorical===true,reply,skippedHistoricalDates,effects,revisionIds:revisions.map(row=>row.revisionId)};
   const updated={...parent,staffId:person.staffId,staffName:parent.staffName||person.name,branch:person.branch,status:'Approved',activeLeaveDates:copy(plan.after),leaveVersion:Number(parent.leaveVersion||0)+1,leaveState:plan.after.length?plan.after.some(date=>date>=today)?decision.kind==='Dates'?'Dates changed':plan.removed.length?'Partially cancelled':parent.leaveState||'Active':'Completed':'Cancelled',leaveScheduleSync:{version:1,updatedAt:at,activeDates:copy(plan.after),revisionIds:decision.revisionIds,skippedHistoricalDates},leaveActions:[...(parent.leaveActions||[]),decision],staffAcknowledged:false,pendingLeaveChangeId:request.type==='Leave Change'?null:parent.pendingLeaveChangeId||null};
   if(parent.status==='Pending'){updated.managerReply=reply;updated.processedAt=api.serverTimestamp?.()||at;updated.processedBy=api.sessionUser.cashierName||actor.email;updated.processedUid=actor.uid;updated.originalLeaveApproval={at,actor,reply,startDate:parent.startDate,endDate:parent.endDate,reason:parent.reason||''};}
   let childRef,child;if(mode==='change'){childRef=ref('staff_requests',input.operationId);if(await get(childRef))throw Error('This management change reference already exists.');child={type:'Leave Change',schemaVersion:1,staffId:person.staffId,staffName:person.name,branch:person.branch,leaveRequestId:parentId,changeKind:input.kind,reason:String(input.reason||reply),status:'Approved',requestedActiveDates:plan.after,sourceLeaveVersion:parent.leaveVersion||0,staffAcknowledged:false,timestamp:api.serverTimestamp?.()||at,processedAt:api.serverTimestamp?.()||at,processedBy:api.sessionUser.cashierName||actor.email,processedUid:actor.uid,managerReply:reply,managementCreated:true};}
   for(const index of indices.values())if(new TextEncoder().encode(JSON.stringify(index)).length>950000)throw Error('This schedule month is too large to save safely.');if(new TextEncoder().encode(JSON.stringify(updated)).length>900000)throw Error('This leave history is too large. Ask HQ to review it.');guard(key,person.branch);
   for(const revision of revisions)tx.set(settings(revisionId(revision.revisionId)),revision);for(const [month,index]of indices)tx.set(settings(monthId(month)),index);if(currentHead)tx.set(settings('global_schedule'),{...currentHead.snapshot,scheduleRevisionId:currentHead.revisionId,scheduleEffectiveFrom:currentHead.effectiveFrom,payrollHistoryEnforcedFrom:currentHead.payrollHistoryEnforcedFrom});
   tx.set(claimRef,{schemaVersion:1,kind:'staff-leave-claims',staffId:person.staffId,dates:claimed,updatedAt:at});tx.set(parentRef,updated);
   if(request.type==='Leave Change')tx.set(requestRef,{...request,status:'Approved',managerReply:reply,processedAt:api.serverTimestamp?.()||at,processedBy:api.sessionUser.cashierName||actor.email,processedUid:actor.uid,staffAcknowledged:false,scheduleRevisionIds:decision.revisionIds});if(childRef)tx.set(childRef,child);
   return {alreadySaved:false,status:'Approved',changedDates:affected,historicalDates,skippedHistoricalDates,publishedCurrent:!!currentHead,effects};
  }));
 }
 return {review:input=>decide(input,input.action==='Rejected'?'reject':'approve'),sync:input=>decide(input,'sync'),change:input=>decide(input,'change'),canReview:branch=>canReviewLeave(api,branch)};
}
