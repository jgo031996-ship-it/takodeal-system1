import {loadScheduleMonthView} from './schedule-sync.js';
import {buildApprovedScheduleProposalSnapshot,normalizeScheduleProposal} from './schedule-proposal-model.js';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
const canonical=x=>JSON.stringify(x,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fresh=s=>{if(!s||s.metadata?.fromCache||s.metadata?.hasPendingWrites||s.docs?.some(d=>d.metadata?.fromCache||d.metadata?.hasPendingWrites))throw Error('Connect to HQ before reviewing schedules.');return s;};
const profile=(p,staffId)=>({staffId,name:p.cashierName,scheduleName:p.scheduleNickname||p.cashierName,branch:p.branch,active:p.active!==false&&p.blocked!==true&&p.archived!==true&&!['revoked','resigned','terminated','inactive','blocked','disabled','deleted','archived'].includes(String(p.status||'').trim().toLowerCase())&&!['REVOKED','BLOCKED'].includes(String(p.pin||'').trim().toUpperCase())&&['staff','staff crew','crew','cashier','manager'].includes(String(p.role||'Staff').trim().toLowerCase())});
export function createScheduleProposalReview(api,{now=()=>new Date()}={}){
 const ref=id=>api.doc(api.db,'branch_schedule_proposals',id),operations=new Map();
 const identity=()=>canonical([api.auth?.currentUser?.uid,api.auth?.currentUser?.email,api.sessionUser?.uid,api.sessionUser?.email,api.sessionUser?.isOwner]);
 function owner(){const u=api.auth?.currentUser,s=api.sessionUser;if(!u?.uid||u.email?.toLowerCase()!=='jgo031996@gmail.com'||u.emailVerified!==true||s?.isOwner!==true||s.uid!==u.uid||s.email?.toLowerCase()!==u.email.toLowerCase()||s.isFranchisee)throw Error('Sign in and unlock the verified Owner account before reviewing schedules.');return {uid:u.uid,email:u.email};}
 const guard=key=>{owner();if(identity()!==key)throw Error('The Owner account changed. Reopen this schedule review.');};
 async function load(idValue){owner();if(!id(idValue))throw Error('Choose a saved schedule proposal.');const key=identity(),s=fresh(await api.getDocFromServer(ref(idValue)));guard(key);if(!s.exists()||s.data().schemaVersion!==1||s.data().proposal?.id!==idValue)throw Error('The saved proposal is unavailable.');return {id:idValue,...s.data()};}
 async function list({status='Pending',month,cursor=null}={}){
  owner();if(cursor!==null&&!id(cursor))throw Error('Refresh the proposal list before continuing.');
  const key=identity(),where=month?api.where('proposal.month','==',month):api.where('status','==',status),constraints=[where];
  if(cursor!==null){
   const saved=fresh(await api.getDocFromServer(ref(cursor)));guard(key);
   if(!saved.exists()||saved.data()?.schemaVersion!==1||saved.data()?.proposal?.id!==cursor||(month?saved.data().proposal.month!==month:saved.data().status!==status))throw Error('The saved list position changed. Refresh proposals before continuing.');
   constraints.push(api.startAfter(saved));
  }
  constraints.push(api.limit(101));
  const saved=fresh(await api.getDocsFromServer(api.query(api.collection(api.db,'branch_schedule_proposals'),...constraints)));guard(key);
  const physical=saved.docs.slice(0,100),rows=physical.map(row=>({id:row.id,...row.data()})).sort((a,b)=>String(b.submittedAt).localeCompare(String(a.submittedAt)));
  Object.defineProperty(rows,'nextCursor',{value:saved.docs.length>100?physical.at(-1).id:null,enumerable:false});return rows;
 }
 async function context(row,{read=api.getDocFromServer.bind(api),transaction}={}){
  const checkedRead=async reference=>fresh(await read(reference));
  const adapter={...api,getDocFromServer:checkedRead},view=await loadScheduleMonthView(adapter,{month:row.proposal.month,now:now()});
  const ids=new Set([row.submittedBy.staffId]);for(const p of view.editorSnapshot?.employees||[])if(id(p.staffId)&&p.branch===row.proposal.branch)ids.add(p.staffId);
  for(const day of row.proposal.days||[]){for(const slot of day.scheduled||[])if(slot.staffId)ids.add(slot.staffId);for(const key of ['standbyStaffIds','offStaffIds'])for(const staffId of day[key]||[])ids.add(staffId);}
  if(ids.size>120)throw Error('This proposal has too many staff references.');
  const people=await Promise.all([...ids].map(async staffId=>{const snap=await checkedRead(api.doc(api.db,'cashiers',staffId));return snap.exists()?profile(snap.data(),staffId):{staffId,active:false};}));
  const proposal=normalizeScheduleProposal(row.proposal,{monthView:view,staff:people,today:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(now())});
  return {view,staff:people,proposal,snapshot:buildApprovedScheduleProposalSnapshot(view,proposal,people)};
 }
 async function prepare(idValue){const row=await load(idValue),key=identity();if(row.status!=='Pending')return {row};const result=await context(row);guard(key);return {row,...result};}
 function decide({id:idValue,decision,reason,expectedIntent}){
  const actor=owner(),key=identity();if(!id(idValue)||!['Approved','Rejected'].includes(decision)||typeof reason!=='string'||reason.trim().length<3||reason.length>1500)throw Error('Choose a proposal, decision and review note of at least 3 characters.');
  const operationKey=canonical([key,idValue]),intent=canonical([decision,reason.trim(),expectedIntent]);
  if(operations.has(operationKey)){const pending=operations.get(operationKey);if(pending.intent!==intent)throw Error('The earlier decision is still awaiting confirmation. Refresh its status before changing the review.');return pending.promise;}
  const work=(async()=>{
   const row=await load(idValue);guard(key);if(row.intent!==expectedIntent)throw Error('This proposal changed. Refresh and review it again.');
   const revisionId='proposal-'+idValue;if(row.status===decision&&(decision==='Rejected'||row.revisionId===revisionId))return {alreadySaved:true,row};if(row.status!=='Pending')throw Error('Another review already decided this proposal. Refresh its saved status.');
   const review={status:decision,reviewedAt:api.serverTimestamp(),reviewedByUid:actor.uid,reviewedByEmail:actor.email,reviewNote:reason.trim(),revisionId:decision==='Approved'?revisionId:null};
   if(decision==='Rejected'){
    await api.runTransaction(api.db,async tx=>{guard(key);const current=await tx.get(ref(idValue));guard(key);if(!current.exists()||current.data().intent!==expectedIntent)throw Error('The saved proposal changed.');const data=current.data();if(data.status==='Rejected')return;if(data.status!=='Pending')throw Error('Another review already decided this proposal.');tx.set(ref(idValue),{...data,...review});});
   }else{
    const prepared=await context(row);guard(key);const snapshot=prepared.snapshot;
    await api.getScheduleHistoryStore().save(snapshot,{expectedRevisionId:row.proposal.baseRevisionId,effectiveFrom:row.proposal.from,effectiveTo:row.proposal.to,revisionId,source:'cashier-schedule-proposal',actor:actor.email,
     readExtra:async(tx,{revision})=>{guard(key);const saved=await tx.get(ref(idValue));if(!saved.exists()||saved.data().status!=='Pending'||saved.data().intent!==expectedIntent)throw Error('This proposal was already reviewed or changed.');
      const next=await context(saved.data(),{read:reference=>tx.get(reference),transaction:tx});guard(key);if(canonical(next.snapshot)!==canonical(snapshot))throw Error('The saved branch schedule or staff directory changed. Review the proposal again.');
      return {row:saved.data(),revision};},
     writeExtra:async(tx,extra)=>{guard(key);if(!extra?.revision)throw Error('The schedule revision was not prepared.');
      tx.set(api.doc(api.db,'settings','schedule_revision_'+revisionId),{...extra.revision,branchScheduleProposalId:idValue,branchScheduleProposalAudit:{submittedBy:extra.row.submittedBy,submittedAt:extra.row.submittedAt,reviewedByUid:actor.uid,reviewedByEmail:actor.email,approvedAt:api.serverTimestamp()}});
      tx.set(ref(idValue),{...extra.row,...review});}
    });
   }
   guard(key);const confirmed=await load(idValue);if(confirmed.status!==decision||decision==='Approved'&&confirmed.revisionId!==revisionId)throw Error('HQ has not confirmed this decision. Refresh the proposal before retrying.');
   return {alreadySaved:false,row:confirmed};
  })();const entry={intent,promise:work};operations.set(operationKey,entry);work.finally(()=>{if(operations.get(operationKey)===entry)operations.delete(operationKey);}).catch(()=>{});return work;
 }
 return {list,load,prepare,decide,context};
}
