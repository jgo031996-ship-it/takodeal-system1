import {OWNER_EMAIL,canOpenWorkspacePage} from './workspace-access-model.js';
import {monthKey,scheduleDateKey,shiftAmendmentFingerprint} from './schedule-history.js';

const fields=['currentSchedule','branchConfig','unavailability','holidays'];
const collection='hq_schedule_drafts';
const unsafe=new Set(['__proto__','prototype','constructor']);
const same=(a,b)=>shiftAmendmentFingerprint(a)===shiftAmendmentFingerprint(b);
const map=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const bytes=new TextEncoder();
async function digest(value){
  const hash=await crypto.subtle.digest('SHA-256',bytes.encode(shiftAmendmentFingerprint(value)));
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export const isScheduleCoOwner=session=>/^co[ _-]?owner$/i.test(String(session?.role||'').trim())&&session?.email?.toLowerCase()!==OWNER_EMAIL;
function actor(api,asOwner){
  const user=api.auth?.currentUser,session=api.sessionUser;
  if(!user?.uid||user.uid!==session?.uid||user.emailVerified!==true||user.email?.toLowerCase()!==session.email?.toLowerCase()
    ||session.isFranchisee||!canOpenWorkspacePage(session,'schedule')
    ||(asOwner?session.email.toLowerCase()!==OWNER_EMAIL:!isScheduleCoOwner(session)))throw Error('Reopen Schedule Manager with the authorized '+(asOwner?'Owner':'Co-owner')+' account.');
  return user;
}
export function rosterChanges(before,after) {
  const changes=[];
  function compare(path,a,b){
    if(same(a,b))return;
    if(map(a)&&map(b)){
      for(const key of new Set([...Object.keys(a),...Object.keys(b)])){
        if(unsafe.has(key))throw Error('An unsupported roster key needs review.');
        compare([...path,key],a[key],b[key]);
      }
    }else changes.push({path,before:a===undefined?{exists:false}:{exists:true,value:a},after:b===undefined?{exists:false}:{exists:true,value:b}});
  }
  for(const key of fields)compare([key],before[key]||{},after[key]||{});
  return changes;
}
function applyChanges(input,changes){
  const next=structuredClone(input);
  if(!Array.isArray(changes)||!changes.length||changes.length>12000)throw Error('This proposal has invalid changes.');
  for(const change of changes){
    const p=change.path;
    if(!Array.isArray(p)||!fields.includes(p[0])||p.length<2||p.length>16||p.some(k=>typeof k!=='string'||unsafe.has(k))||typeof change.before?.exists!=='boolean'||typeof change.after?.exists!=='boolean')throw Error('The proposal contains an invalid roster field.');
    let node=next;for(const k of p.slice(0,-1)){if(!Object.hasOwn(node,k)||!map(node[k]))throw Error('The original schedule structure changed. Request a fresh proposal.');node=node[k];}
    const key=p.at(-1);
    if(Object.hasOwn(node,key)!==change.before.exists||change.before.exists&&!same(node[key],change.before.value))throw Error('The original '+p.join(' / ')+' changed. Request a fresh proposal.');
    if(change.after.exists)node[key]=structuredClone(change.after.value);else delete node[key];
  }
  return next;
}
const currentBase=async(view)=>digest({month:view.month,revision:view.expectedRevisionId??null,
  snapshot:Object.fromEntries(fields.map(k=>[k,view.editorSnapshot[k]||{}])),head:view.source==='live-unarchived'?view.headFingerprint:null});
export async function submitRosterReview(api,snapshot,view,effectiveFrom){
  const user=actor(api,false);
  if(!view||view.month!==monthKey(snapshot)||view.month!==effectiveFrom?.slice(0,7)||api.scheduleMemoryReadOnly)throw Error('Reload the selected month before submitting.');
  const changes=rosterChanges(view.editorSnapshot,snapshot);
  if(!changes.length)throw Error('There are no schedule changes to submit.');
  const baseDigest=await currentBase(view),intent={month:view.month,baseRevision:view.expectedRevisionId??null,baseDigest,effectiveFrom,changes,submittedByUid:user.uid};
  const id=await digest(intent),ref=api.doc(api.db,collection,id);
  if(bytes.encode(JSON.stringify(intent)).length>820000)throw Error('This proposal is too large. Submit a smaller group of changes.');
  return api.runTransaction(api.db,async tx=>{
    const [prior,index,head]=await Promise.all([tx.get(ref),tx.get(api.doc(api.db,'settings','schedule_month_'+view.month.replace('-','_'))),tx.get(api.doc(api.db,'settings','global_schedule'))]);
    if(actor(api,false)!==user)throw Error('The submitting account changed.');
    if(prior.exists()){if(prior.data().status==='Pending')return id;throw Error('This proposal has already been reviewed. Reload its result before submitting again.');}
    const current=head.exists()?head.data():null;
    if((index.exists()?index.data().latestRevisionId:null)!==(view.expectedRevisionId??null)
      ||current&&monthKey(current)===view.month&&shiftAmendmentFingerprint(current)!==view.headFingerprint)
      throw Error('This schedule changed in another session. Reload its month before submitting.');
    tx.set(ref,{...intent,status:'Pending',submittedByEmail:user.email,submittedAt:api.serverTimestamp()});return id;
  });
}
export async function decideRosterReview(api,{id,proposal,view,approve}){
  const user=actor(api,true);
  if(!/^[a-f0-9]{64}$/.test(id)||proposal.status!=='Pending')throw Error('Reload this pending proposal.');
  const ref=api.doc(api.db,collection,id);
  async function inspect(tx){
    const snap=await tx.get(ref),saved=snap.exists()&&snap.data();
    if(actor(api,true)!==user||!saved||saved.status!=='Pending'||saved.baseDigest!==proposal.baseDigest||!same(saved.changes,proposal.changes)
      ||saved.month!==proposal.month||saved.baseRevision!==proposal.baseRevision||saved.effectiveFrom!==proposal.effectiveFrom||saved.submittedByUid!==proposal.submittedByUid)
      throw Error('The proposal or account changed. Reload its decision.');
    return saved;
  }
  const decision=(status,revision)=>({status,reviewedByUid:user.uid,reviewedByEmail:user.email,
    reviewedAt:new Date().toISOString(),reviewRevision:revision});
  if(!approve)return api.runTransaction(api.db,async tx=>{await inspect(tx);tx.update(ref,decision('Rejected',null));});
  if(view.month!==proposal.month||view.expectedRevisionId!==proposal.baseRevision||await currentBase(view)!==proposal.baseDigest)
    throw Error('The shared roster changed after submission. Request a fresh Co-owner proposal.');
  if(proposal.effectiveFrom<scheduleDateKey(new Date()))throw Error('The proposed effective date has passed. Review the remaining dates in a fresh proposal.');
  const snapshot=applyChanges(view.editorSnapshot,proposal.changes),revisionId='hq-review-'+id;
  return api.getScheduleHistoryStore().save(snapshot,{expectedRevisionId:proposal.baseRevision,revisionId,effectiveFrom:proposal.effectiveFrom,
    actor:user.email,source:'owner-reviewed-roster',assignmentReview:{baseline:view.editorSnapshot,expectedHead:view.headFingerprint},
    readExtra:inspect,writeExtra:tx=>{if(actor(api,true)!==user)throw Error('The approving account changed.');tx.update(ref,decision('Approved',revisionId));}});
}

export async function openRosterReviews(api,document){
  const user=actor(api,true),sync=api.getOwnerScheduleSync(),view=sync.baseline();
  if(!view||sync.isDirty()||sync.isSaving()||api.scheduleMemoryReadOnly)throw Error('Open the latest month and finish your local edits before reviewing proposals.');
  const rows=await api.getDocsFromServer(api.query(api.collection(api.db,collection),api.where('month','==',view.month),api.where('status','==','Pending')));
  if(actor(api,true)!==user||rows.metadata?.fromCache||rows.metadata?.hasPendingWrites)throw Error('Reconnect and reopen the pending proposals.');
  if(!rows.docs.length){api.ManagerUI.notify('No pending Co-owner proposals for '+view.month+'.');return;}
  const modal=document.createElement('dialog');modal.style.cssText='max-width:min(46rem,94vw);max-height:85vh;overflow:auto;border:0;border-radius:12px;padding:1.25rem';
  const add=(tag,text,parent=modal)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
  add('h2','Co-owner schedule proposals · '+view.month);
  const close=add('button','Close');close.onclick=()=>modal.close();
  for(const doc of rows.docs){
    const p=doc.data(),section=add('section',''),summary=add('details','',section);
    add('summary',p.submittedByEmail+' · effective '+p.effectiveFrom+' · '+p.changes.length+' changes',summary);
    const display=cell=>cell.exists?(typeof cell.value==='string'?cell.value:JSON.stringify(cell.value)):'(empty)';
    for(const c of p.changes)add('p',c.path.join(' / ')+' · '+display(c.before)+' → '+display(c.after),summary);
    const status=add('p','',summary);status.setAttribute('role','status');
    const approve=add('button','Approve and save this roster',summary),reject=add('button','Reject proposal',summary);
    async function decide(yes){
      approve.disabled=reject.disabled=true;
      try{
        if(actor(api,true)!==user||sync.isDirty()||sync.baseline()!==view||!await api.ManagerUI.confirm(yes?'Publish the displayed schedule changes?':'Reject this proposal?'))return;
        await decideRosterReview(api,{id:doc.id,proposal:p,view,approve:yes});
        modal.close();if(yes)await sync.load({manual:true});api.ManagerUI.notify(yes?'Schedule approved and saved.':'Proposal rejected.');
      }catch(error){status.textContent=error.message;}finally{approve.disabled=reject.disabled=false;}
    }
    approve.onclick=()=>void decide(true);reject.onclick=()=>void decide(false);
  }
  modal.addEventListener('close',()=>modal.remove(),{once:true});document.body.append(modal);modal.showModal();
}
