import {canOpenWorkspacePage} from './workspace-access-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>typeof value==='number'&&Number.isFinite(value)?String(value):'Not recorded';
const quantity=(row,display,base)=>typeof row[display]==='number'&&Number.isFinite(row[display])&&typeof row.displayUom==='string'&&row.displayUom.trim()
 ? number(row[display])+' '+row.displayUom : number(row[base])+' '+(row.uom||'');
export function dispatchDetailsHTML(rows){
 const first=rows[0];return {header:'<strong>To: '+esc(first.toBranch)+'</strong><br>Driver: '+esc(first.driver||'Not recorded')+'<br>Saved delivery records: '+esc(first.date||'Not recorded'),body:rows.map(row=>'<tr><td style="padding:12px">'+esc(row.item||row.itemName||'Unnamed item')+(row.receivingRemarks?'<br><small>'+esc(row.receivingRemarks)+'</small>':'')+'</td><td style="padding:12px">'+esc(quantity(row,'displayQty','qty'))+'</td><td style="padding:12px">'+esc(quantity(row,'receivedDisplayQty','receivedQty'))+'</td><td style="padding:12px">'+esc(number(row.variance))+' '+esc(row.uom||'')+'</td><td style="padding:12px">'+esc(row.status||'Not recorded')+(row.receivedBy?'<br><small>Received by '+esc(row.receivedBy)+'</small>':'')+'</td></tr>').join('')};
}
export function installOwnerDispatchDetails(api,d,{timeoutMs=12000}={}){
 const el=id=>d.getElementById(id);let epoch=0;
 api.viewDispatchDetails=async(encoded,branch)=>{
  const run=++epoch,modal=el('dispatchDetailsModal');let timer,actor;
  const identity=()=>{const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||session?.uid!==user.uid||session.email?.toLowerCase()!==user.email?.toLowerCase()||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||!canOpenWorkspacePage(session,'dispatch')||typeof branch!=='string'||!branch||api.isBranchAllowed?.(branch)!==true)throw Error('This delivery is outside your current Dispatch access.');return {user,session,key:JSON.stringify([session.permissions,session.allowedBranches])};};
  const current=()=>{const now=identity();if(run!==epoch||now.user!==actor.user||now.session!==actor.session||now.key!==actor.key||modal.style.display!=='flex')throw Error('The account, branch or selected delivery changed. Reopen the details.');};
  try{
   actor=identity();if(!modal)throw Error('Update the Owner app to view delivery details.');if(typeof encoded!=='string'||encoded.length>300000)throw Error('Reopen this delivery from the Logistics Feed.');
   const selected=JSON.parse(decodeURIComponent(encoded));if(!Array.isArray(selected)||!selected.length||selected.length>150||selected.some(row=>!row||typeof row.id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(row.id))||new Set(selected.map(row=>row.id)).size!==selected.length)throw Error('This delivery has incomplete saved item references. Reopen its Logistics Feed entry.');
   el('dispatchDetailsHeader').textContent='Confirming saved delivery details…';el('dispatchDetailsBody').replaceChildren();el('dispatchDetailsFooter').textContent='Read-only delivery details';modal.style.display='flex';
   const rows=await Promise.race([Promise.all(selected.map(async row=>{const snap=await api.getDocFromServer(api.doc(api.db,'dispatch_logs',row.id));current();if(snap.metadata?.fromCache!==false||snap.metadata?.hasPendingWrites!==false||snap.id!==row.id||!snap.exists())throw Error('HQ could not confirm every saved delivery item. Refresh Logistics Feed.');const saved=snap.data();if(saved.toBranch!==branch)throw Error('A delivery item belongs to a different branch. Refresh Logistics Feed.');return {...saved,id:snap.id};})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Delivery details took too long. Close and reopen them to retry.')),timeoutMs);})]);
   current();if(rows.some(row=>row.date!==rows[0].date||row.driver!==rows[0].driver))throw Error('These saved items belong to different deliveries. Refresh Logistics Feed.');const html=dispatchDetailsHTML(rows);el('dispatchDetailsHeader').innerHTML=html.header;el('dispatchDetailsBody').innerHTML=html.body;return true;
  }catch(error){if(run===epoch&&modal){el('dispatchDetailsBody').replaceChildren();el('dispatchDetailsFooter').textContent='Read-only delivery details';try{if(!actor)throw error;current();el('dispatchDetailsHeader').textContent=error.message;}catch{modal.style.display='none';el('dispatchDetailsHeader').textContent='';}}return false;}
  finally{clearTimeout(timer);}
 };return api.viewDispatchDetails;
}
