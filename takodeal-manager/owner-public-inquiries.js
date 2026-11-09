import {OWNER_EMAIL} from './workspace-access-model.js';

// Public submissions are text, including legacy records and their document IDs.
// Never put them into HTML, links, attributes or executable event-handler text.
const documentId=value=>typeof value==='string'&&value.length>0&&value.length<=1500&&!value.includes('/')&&!['.','..'].includes(value);
const fields=['name','phone','email','location','formatInterest','status'];
const stamp=value=>{if(value==null)return null;try{const date=typeof value?.toDate==='function'?value.toDate():value instanceof Date?value:new Date(value);return Number.isFinite(+date)?+date:null;}catch{return null;}};
const fingerprint=row=>JSON.stringify(fields.map(key=>row[key]??null).concat(stamp(row.timestamp)));
export function installOwnerPublicInquiries(api=window,d=document){
 if(api.ownerPublicInquiries)return api.ownerPublicInquiries;
 let epoch=0;const pending=new Map();
 function capture(){
  const user=api.auth?.currentUser,session=api.sessionUser,scope=JSON.stringify([session?.permissions,session?.allowedBranches]);
  if(!user?.uid||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||String(session.email).toLowerCase()!==String(user.email).toLowerCase())throw Error('Sign in with approved Franchise Leads access.');
  const owner=String(user.email).toLowerCase()===OWNER_EMAIL;
  if(!owner&&(!session.permissions?.some(value=>['all','crm'].includes(value))||!session.allowedBranches?.includes('All')))throw Error('The Owner must confirm global Franchise Leads access.');
  return ()=>{if(api.auth?.currentUser!==user||api.sessionUser!==session||JSON.stringify([session.permissions,session.allowedBranches])!==scope)throw Error('Your account changed. Reopen Franchise Leads.');};
 }
 const fresh=snapshot=>{if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Reconnect to confirm saved franchise inquiries.');return snapshot;};
 function element(tag,text,style){const node=d.createElement(tag);if(text!==undefined)node.textContent=String(text??'');if(style)node.setAttribute('style',style);return node;}
 function message(body,text){const row=element('tr'),cell=element('td',text,'text-align:center;padding:30px;color:#64748b;');cell.colSpan=5;row.append(cell);body.replaceChildren(row);}
 async function mark(id,{expected,assertView=()=>{},button,status}={}){
  if(!documentId(id))throw Error('Refresh and choose one exact saved inquiry.');
  if(pending.has(id))return pending.get(id);
  const current=capture(),guard=()=>{current();assertView();};guard();
  const work=(async()=>{if(button){button.disabled=true;button.textContent='Updating…';}
   try{
    const ref=api.doc(api.db,'franchise_leads',id),snapshot=fresh(await api.getDocFromServer(ref));guard();
    if(!snapshot.exists())throw Error('This inquiry is no longer available. Refresh the list.');
    const original=snapshot.data(),proof=fingerprint(original);if(expected!==undefined&&proof!==expected)throw Error('This inquiry changed. Refresh before marking it contacted.');
    await api.runTransaction(api.db,async tx=>{guard();const saved=await tx.get(ref);guard();if(!saved.exists()||fingerprint(saved.data())!==proof)throw Error('This inquiry changed. Refresh before marking it contacted.');if(saved.data().status!=='Contacted')tx.update(ref,{status:'Contacted'});});
    current();await load();return true;
   }catch(error){if(status){status.textContent=error.message||'The update was not confirmed. Refresh before retrying.';status.hidden=false;}throw error;}
   finally{if(button){button.disabled=false;button.textContent='Mark Contacted';}}
  })();pending.set(id,work);work.finally(()=>{if(pending.get(id)===work)pending.delete(id);}).catch(()=>{});return work;
 }
 async function load(){
  const body=d.getElementById('franLeadsBody');if(!body)return false;const run=++epoch;message(body,'Loading applications…');
  try{
   const current=capture(),snapshot=fresh(await api.getDocsFromServer(api.query(api.collection(api.db,'franchise_leads'),api.orderBy('timestamp','desc'),api.limit(201))));current();if(run!==epoch)return false;
   if(!Array.isArray(snapshot.docs))throw Error('The franchise inquiry list was incomplete. Refresh to retry.');
   const rows=[];
   for(const saved of snapshot.docs.slice(0,200)){
    fresh(saved);const row=saved.data(),tr=element('tr',undefined,'border-bottom:1px solid #f1f5f9;background:'+(row.status==='Contacted'?'#f8fafc':'white')+';'),date=stamp(row.timestamp);
    tr.append(element('td',date===null?'Unknown Date':new Date(date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}),'padding:15px 20px;color:#64748b;'),element('td',row.name,'padding:15px 20px;font-weight:900;color:#0f172a;'));
    const contact=element('td',undefined,'padding:15px 20px;color:#334155;');contact.append(element('span','📞 '+String(row.phone??'')),element('br'),element('span','📧 '+String(row.email??'')));tr.append(contact,element('td','📍 '+String(row.location??''),'padding:15px 20px;font-weight:bold;color:#d97706;'));
    const actions=element('td',undefined,'padding:15px 20px;text-align:right;'),button=element('button',row.status==='Contacted'?'✅ Contacted':'Mark Contacted','background:#0ea5e9;color:white;border:0;padding:6px 12px;border-radius:6px;font-weight:bold;cursor:pointer;'),status=element('p');button.type='button';status.hidden=true;status.setAttribute('role','status');button.disabled=row.status==='Contacted'||!documentId(saved.id);
    if(!button.disabled)button.onclick=()=>mark(saved.id,{expected:fingerprint(row),button,status,assertView:()=>{if(run!==epoch||d.getElementById('franLeadsBody')!==body)throw Error('The inquiry list changed. Refresh before continuing.');}}).catch(error=>{status.textContent=error.message||'The update was not confirmed. Refresh before retrying.';status.hidden=false;return false;});
    actions.append(button,status);tr.append(actions);rows.push(tr);
   }
   if(snapshot.docs.length>200){const tr=element('tr'),cell=element('td','Showing the 200 most recent inquiries. Older applications remain saved.');cell.colSpan=5;tr.append(cell);rows.push(tr);}
   if(rows.length)body.replaceChildren(...rows);else message(body,'No leads found yet.');return true;
  }catch(error){if(run===epoch)message(body,error.message||'Error loading leads.');return false;}
 }
 return api.ownerPublicInquiries={load,mark};
}
