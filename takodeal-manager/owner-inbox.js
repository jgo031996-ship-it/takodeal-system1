import {canOpenWorkspacePage,OWNER_EMAIL} from './workspace-access-model.js';
import {requestHistory,historyTime} from './request-history.js';
import {isMealDeduction} from './payroll-safety.js';
import {leaveRequestSummaryHTML} from './manager-leave-ui.js';
import {earlyTimeOutSummaryHTML} from './early-time-out-review-ui.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const email=value=>String(value||'').trim().toLowerCase();
export function inboxActorKey(w){
 const user=w.auth?.currentUser,session=w.sessionUser;
 if(!user?.uid||!user.email||user.emailVerified!==true||session?.uid!==user.uid||email(session.email)!==email(user.email)||!canOpenWorkspacePage(session,'inbox'))return null;
 return JSON.stringify([user.uid,email(user.email),user.emailVerified,session.uid,email(session.email),session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches,session.branch,session.assignedBranch]);
}
const snapshotRows=snapshot=>snapshot.docs?snapshot.docs.map(row=>({...row.data(),id:row.id})):(()=>{const rows=[];snapshot.forEach(row=>rows.push({...row.data(),id:row.id}));return rows;})();
const fresh=snapshot=>{if(snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||snapshot.docs?.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('Connect to HQ and refresh the saved requests.');return snapshot;};
const money=value=>(Number(value)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
function dateLabel(value){const time=historyTime(value),dayOnly=typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);return time?new Date(time).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',...(dayOnly?{}:{timeStyle:'short'})})+(dayOnly?' · time not recorded':' (PH)'):'Submission time not recorded';}

// The sidebar count remains live on other pages, but only for this account's
// assigned branches. Account changes stop the previous subscriptions first.
export function installInboxBadge(w,d){
 if(w.ownerInboxBadge)return w.ownerInboxBadge;
 let key=null,generation=0,stops=[];const node=()=>d.getElementById('inboxBadge');
 function stop(){generation++;for(const unsubscribe of stops.splice(0))unsubscribe?.();key=null;const badge=node();if(badge)badge.style.display='none';}
 function refresh(){
  const next=inboxActorKey(w);if(next===key)return;if(stops.length||key!==null)stop();if(!next||typeof w.onSnapshot!=='function')return;
  const session=w.sessionUser,all=email(w.auth.currentUser.email)===OWNER_EMAIL||session.allowedBranches?.includes('All'),branches=all?[null]:[...new Set((session.allowedBranches||[]).filter(branch=>typeof branch==='string'&&branch&&branch!=='All'))];
  if(!branches.length)return;key=next;const version=++generation,counts=new Map();
  for(const branch of branches){
   const filters=[w.where('status','==','Pending')];if(branch)filters.push(w.where('branch','==',branch));
   const unsubscribe=w.onSnapshot(w.query(w.collection(w.db,'staff_requests'),...filters),snapshot=>{
    if(version!==generation)return;if(inboxActorKey(w)!==key){refresh();return;}
    const rows=snapshotRows(snapshot).filter(row=>row.status==='Pending'&&(all||branches.includes(row.branch)));counts.set(branch,new Set(rows.map(row=>row.id)));
    if(counts.size!==branches.length)return;const ids=new Set([...counts.values()].flatMap(value=>[...value])),badge=node();if(badge){badge.innerText=ids.size;badge.style.display=ids.size?'inline-block':'none';}
   },()=>{if(version===generation){const badge=node();if(badge)badge.style.display='none';}});stops.push(unsubscribe);
  }
 }
 const control={refresh,stop};w.ownerInboxBadge=control;w.refreshOwnerInboxBadge=refresh;w.stopOwnerInboxBadge=stop;
 w.addEventListener?.('focus',refresh);d.addEventListener?.('visibilitychange',()=>{if(d.visibilityState!=='hidden')refresh();});
 w.auth?.onAuthStateChanged?.(()=>refresh());refresh();return control;
}

// HR records stay in this verified workspace's memory. A confirmed decision reads
// its one saved request; it never waits for a second complete history download.
export function installOwnerInbox(w,d,{timeoutMs=25000,pageSize=50}={}){
 const size=Math.max(1,Math.min(100,Math.floor(pageSize)||50)),loads=new Map(),updates=new Map();let state=null,sequence=0;
 const node=id=>d.getElementById(id),rowAccess=(row)=>{
  const session=w.sessionUser;
  if(email(w.auth.currentUser.email)===OWNER_EMAIL)return true;
  const branches=Array.isArray(session.allowedBranches)?session.allowedBranches:[];
  return branches.includes('All')||!!row.branch&&branches.includes(row.branch);
 };
 const allowed=row=>!!inboxActorKey(w)&&rowAccess(row);
 function workspace(){w.refreshOwnerInboxBadge?.();const key=inboxActorKey(w);if(!key){state=null;return null;}if(state?.key!==key)state={key,loaded:false,requests:[],deductions:[],overlays:new Map(),groups:[],groupIds:new Map(),open:new Set(),pages:new Map(),records:[]};return state;}
 const current=target=>state===target&&inboxActorKey(w)===target.key;
 function visible(promise){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ is taking longer than expected. Retry Refresh Inbox; no request was changed.')),timeoutMs);})]).finally(()=>clearTimeout(timer));}
 function share(map,key,work){let physical=map.get(key);if(!physical){physical=Promise.resolve().then(work);map.set(key,physical);const release=()=>{if(map.get(key)===physical)map.delete(key);};physical.then(release,release);}return visible(physical);}
 function emptyAccess(){const pending=node('inboxTableBody'),resolved=node('resolvedRequestsBody');if(pending)pending.innerHTML='<tr><td colspan="6">Unlock an approved Request Inbox account to load requests.</td></tr>';if(resolved)resolved.innerHTML='<tr><td colspan="5">Request history is available after approved sign-in.</td></tr>';const badge=node('inboxBadge');if(badge)badge.style.display='none';}
 function details(row,index){
  let html='';
  if(row.historySource==='deduction')html='<strong style="color:#0f766e;">'+escape(row.item||'POS meal deduction')+'</strong><br><span style="color:var(--danger);font-weight:bold;">Deduct: ₱'+money(row.amount)+'</span><br><small style="color:#64748b;">Recorded automatically by POS'+(row.receiptId?' · Receipt '+escape(row.receiptId):'')+'</small>';
  else if(row.type==='Leave'||row.type==='Leave Change')html=leaveRequestSummaryHTML(row);
  else if(row.type==='Early Time Out')html=earlyTimeOutSummaryHTML(row);
  else if(row.type==='Cash Advance')html='<strong style="color:var(--danger);font-size:15px;">₱'+money(row.amount)+'</strong><br><small>'+escape(row.reason||'No reason provided')+'</small>';
  else if(row.type==='Reason Letter')html='<strong>Cause: '+escape(row.explanationCause||'Variance')+'</strong><br><small>'+escape(row.explanationMessage||'No explanation provided')+'</small>';
  else if(isMealDeduction(row.type))html='<strong style="color:#0f766e;">🍔 '+escape(row.item||'Food Item').replace(/ \| /g,'<br>')+'</strong><br><span style="color:var(--danger);font-weight:bold;">Deduct: ₱'+money(row.amount)+'</span>';
  else html=row.amount?'₱'+money(row.amount):escape(row.item||row.reason||'N/A');
  if(row.photoBase64||row.proofImageUrl||row.imageUrl||row.image)html+='<br><button type="button" onclick="window.ownerInbox.photo('+index+','+state.drawVersion+')">📷 View Photo</button>';
  return html;
 }
 function draw(target){
  if(!current(target)||!target.loaded)return false;
  const rows=requestHistory(target.requests.filter(rowAccess),target.deductions.filter(rowAccess));target.records=rows;target.drawVersion=(target.drawVersion||0)+1;const grouped=new Map();let pending='',count=0;
  rows.forEach((row,index)=>{
   if(row.status!=='Pending'){const name=String(row.staffName||'Unknown');if(!grouped.has(name))grouped.set(name,[]);grouped.get(name).push({row,index});return;}
   count++;pending+='<tr data-inbox-request="'+escape(row.id)+'"><td style="padding:12px;color:#64748b;">'+escape(dateLabel(row.timestamp))+'</td><td style="padding:12px;font-weight:bold;">'+escape(row.staffName||'Unknown')+'</td><td style="padding:12px;"><span class="badge badge-closed">'+escape(row.branch||'Not recorded')+'</span></td><td style="padding:12px;"><strong>'+escape(row.type||'Request')+'</strong><br><span style="background:#fef9c3;color:#854d0e;font-size:11px;">Pending Review</span></td><td style="padding:12px;max-width:250px;white-space:normal;">'+details(row,index)+'</td><td style="padding:12px;"><button type="button" onclick="window.ownerInbox.review('+index+',\'Approved\','+target.drawVersion+')" style="background:#166653;color:white;padding:7px 12px;border:0;border-radius:5px;margin:3px;">Approve</button><button type="button" onclick="window.ownerInbox.review('+index+',\'Rejected\','+target.drawVersion+')" style="background:#b83c3c;color:white;padding:7px 12px;border:0;border-radius:5px;margin:3px;">Reject</button></td></tr>';
  });
  target.groups=[];let history='';
  for(const [name,entries] of grouped){
   if(!target.groupIds.has(name))target.groupIds.set(name,'history'+target.groupIds.size);
   const id=target.groupIds.get(name),expanded=target.open.has(id),pages=Math.ceil(entries.length/size),page=Math.min(target.pages.get(id)||0,pages-1);target.pages.set(id,page);target.groups.push({id,entries});
   history+='<tr><td colspan="4" style="padding:18px;font-weight:bold;"><button type="button" aria-expanded="'+expanded+'" onclick="window.toggleResolvedStaff(\''+id+'\')" style="background:none;border:0;color:inherit;font:inherit;cursor:pointer;">'+(expanded?'▲':'▼')+' 👤 '+escape(name)+'</button></td><td style="padding:18px;text-align:right;"><button type="button" onclick="window.toggleResolvedStaff(\''+id+'\')">View '+entries.length+' Records</button></td></tr>';
   if(!expanded)continue;
   for(const {row,index} of entries.slice(page*size,(page+1)*size)){
    const rejected=row.status==='Rejected',badge=row.deductionStatus?'<br><span style="font-size:11px;font-weight:bold;color:'+(row.deductionStatus==='Paid'?'#16a34a':'#b45309')+';">'+escape(row.deductionStatus)+'</span>':'';
    history+='<tr class="res-row-'+id+'" style="background:#f8fafc;"><td style="padding:12px;color:#64748b;">'+escape(dateLabel(row.timestamp))+'</td><td style="padding:12px;">'+escape(row.branch||'Not recorded')+'</td><td style="padding:12px;">'+escape(row.type||'Request')+'</td><td style="padding:12px;max-width:250px;white-space:normal;">'+details(row,index)+'</td><td style="padding:12px;text-align:right;"><span style="color:'+(rejected?'#b91c1c':'#0f766e')+';">'+escape(row.status)+'</span>'+badge+'</td></tr>';
   }
   if(pages>1)history+='<tr><td colspan="5" style="padding:12px;text-align:right;"><button type="button" '+(page===0?'disabled ':'')+'onclick="window.ownerInbox.page(\''+id+'\','+(page-1)+')">Previous</button> <span>Records '+(page*size+1)+'–'+Math.min((page+1)*size,entries.length)+' of '+entries.length+'</span> <button type="button" '+(page+1>=pages?'disabled ':'')+'onclick="window.ownerInbox.page(\''+id+'\','+(page+1)+')">Next</button></td></tr>';
  }
  const pendingBody=node('inboxTableBody'),resolved=node('resolvedRequestsBody'),badge=node('inboxBadge');
  if(pendingBody)pendingBody.innerHTML=pending||'<tr><td colspan="6" style="padding:30px;color:#166653;">No pending requests! 🎉</td></tr>';
  if(resolved)resolved.innerHTML=history||'<tr><td colspan="5" style="padding:30px;">No resolved history yet.</td></tr>';
  if(badge){badge.innerText=count;badge.style.display=count?'inline-block':'none';}
  return true;
 }
 function refs(table){const session=w.sessionUser,base=w.collection(w.db,table),all=email(w.auth.currentUser.email)===OWNER_EMAIL||session.allowedBranches?.includes('All'),branches=[...new Set((session.allowedBranches||[]).filter(branch=>typeof branch==='string'&&branch&&branch!=='All'))];if(!all&&!branches.length)throw Error('No request branches are assigned to this account.');return (all?[null]:branches).map(branch=>branch?w.query(base,w.where('branch','==',branch)):base);}
 async function load(){
  if(!node('inboxTableBody'))return false;
  const target=workspace();if(!target){emptyAccess();return false;}
  if(!target.loaded)node('inboxTableBody').innerHTML='<tr><td colspan="6">Loading requests…</td></tr>';
  try{return await share(loads,target.key,async()=>{
   const start=sequence,read=w.getDocsFromServer||w.getDocs;if(typeof read!=='function')throw Error('Connect to HQ to load saved requests.');
   const [requests,deductions]=await Promise.all(['staff_requests','staff_deductions'].map(async table=>{const snapshots=await Promise.all(refs(table,target).map(reference=>read(reference)));const records=new Map();for(const snapshot of snapshots)for(const row of snapshotRows(fresh(snapshot)))if(allowed(row))records.set(row.id,row);return [...records.values()];}));
   if(!current(target))return false;
   const merged=new Map(requests.map(row=>[row.id,row]));for(const [id,overlay] of target.overlays)if(overlay.sequence>start){if(overlay.row)merged.set(id,overlay.row);else merged.delete(id);}else target.overlays.delete(id);
   target.requests=[...merged.values()];target.deductions=deductions;target.loaded=true;return draw(target);
  });}catch(error){if(current(target)){if(!target.loaded)node('inboxTableBody').innerHTML='<tr><td colspan="6" role="alert">'+escape(error.message||'Requests could not load. Retry Refresh Inbox.')+'</td></tr>';else w.ManagerUI?.notify?.('Saved inbox remains visible. '+(error.message||'Refresh could not finish.'));}return false;}
 }
 async function applyConfirmedRequest(id){
  const target=workspace();if(!target||typeof id!=='string'||!id||id.includes('/'))return false;
  return share(updates,target.key+'|'+id,async()=>{
   const read=w.getDocFromServer;if(typeof read!=='function')throw Error('Refresh this saved request from HQ.');const snapshot=fresh(await read(w.doc(w.db,'staff_requests',id)));
   if(!current(target))return false;
   const row=snapshot.exists()?{...snapshot.data(),id}:null;if(row&&!allowed(row))throw Error('This request is outside your branch access.');
   target.overlays.set(id,{row,sequence:++sequence});const requests=new Map(target.requests.map(entry=>[entry.id,entry]));if(row)requests.set(id,row);else requests.delete(id);target.requests=[...requests.values()];return target.loaded?draw(target):false;
  });
 }
 function toggle(id){const target=workspace();if(!target?.loaded||!target.groups.some(group=>group.id===id))return false;if(target.open.has(id))target.open.delete(id);else target.open.add(id);return draw(target);}
 function page(id,value){const target=workspace(),group=target?.groups.find(entry=>entry.id===id);if(!group||!Number.isSafeInteger(value)||value<0||value>=Math.ceil(group.entries.length/size))return false;target.pages.set(id,value);target.open.add(id);return draw(target);}
 function request(id){const target=workspace();return target?.loaded?target.requests.find(row=>row.id===id&&allowed(row))||null:null;}
 function review(index,decision,version){const target=workspace(),row=target?.records[index];if(!row||version!==undefined&&version!==target.drawVersion||row.status!=='Pending'||!allowed(row)||!['Approved','Rejected'].includes(decision))return false;return w.handleRequest?.(row.id,decision,row.type,Number(row.amount)||0,row.staffName||'Unknown');}
 function photo(index,version){const target=workspace(),row=target?.records[index];if(!row||version!==undefined&&version!==target.drawVersion||!allowed(row))return false;const url=row.photoBase64||row.proofImageUrl||row.imageUrl||row.image;if(url)w.viewSelfie?.(url,'Attached Photo from '+String(row.staffName||'Staff'));}
 const controller={load,applyConfirmedRequest,toggle,page,request,review,photo,clear(){state=null;}};w.ownerInbox=controller;return controller;
}
