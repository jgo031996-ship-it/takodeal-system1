import {captureDispatchAuthority,prepareDispatchRestock,commitDispatch,assertDispatchRequestAvailable} from './dispatch-safety.js';
import {commitSetAside} from './dispatch-set-aside.js';
import {canonicalDispatchIntent,isDispatchAutoRestock} from './dispatch-restock-model.js';
import {collectDispatchRestockEstimates,renderDispatchRestockEstimates} from './dispatch-restock-finance.js';
import {canOpenWorkspacePage} from './workspace-access-model.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>value===null?'Needs price review':'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const quantity=value=>Number(value).toLocaleString('en-PH',{maximumFractionDigits:6});
const savedAttempt=(storage,key)=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{throw Error('The saved delivery attempt needs review. Refresh Dispatch before sending.');}};
const ids=storage=>[...new Set(String(storage.getItem('takodeal_active_po')||'').split(',').map(value=>value.trim()).filter(Boolean))].sort();
export function collectDispatchDraft(api,{document:d,storage}){
 const source=d.getElementById('dispFrom')?.value,destination=d.getElementById('dispTo')?.value;
 if(!source||!destination||source===destination)throw Error('Choose different Source and Destination branches.');
 const allItems=(api.dispatchCart||[]).map((row,index)=>{
  const field=d.getElementById('cartQty_'+index),raw=Number(field?field.value:row.rawQty??row.qty),rate=Number(row.convRate??1),qty=raw*rate;
  if(!Number.isFinite(raw)||raw<0||!Number.isFinite(rate)||rate<=0||!Number.isFinite(qty))throw Error('Enter a valid quantity for every item.');
  return {...row,rawQty:raw,qty};
 });
 const items=allItems.filter(row=>row.qty>0),skipped=[];
 allItems.forEach(row=>{const remaining=Number(row.origBaseQty??row.qty)-row.qty;if(remaining>0)skipped.push({...row,qty:remaining,origBaseQty:remaining,rawQty:remaining/row.convRate,displayQty:remaining/row.convRate,origRawQty:remaining/row.convRate});});
 return {source,destination,allItems,items,skipped,purchaseOrderIds:ids(storage)};
}
function preview(plan){
 if(!plan?.needsRestock)return '<p>Stock will be dispatched to the selected branch.</p>';
 return '<div style="text-align:left;font-size:14px"><p><strong>Automatic HQ restock · '+esc(money(plan.estimatedTotal))+'</strong><br>Estimated using the last saved price.</p>'+plan.lines.filter(line=>line.restockQty>0).map(line=>'<div style="border:1px solid #dbe5df;border-radius:8px;padding:10px;margin:8px 0;overflow-wrap:anywhere"><strong>'+esc(line.name)+'</strong><br>Restock: '+esc(quantity(line.restockQty)+' '+line.baseUom)+' · '+esc(money(line.estimatedSubtotal))+(line.correctionQty>0?'<br><small>Old negative balance: '+esc(quantity(line.oldQty)+' '+line.baseUom)+' → 0. This correction is excluded from the purchase cost.</small>':'')+'</div>').join('')+'<p>The restock and dispatch save together. This records an estimate; it does not record a cash payment.</p></div>';
}
export function renderAutoRestockInvoiceRow(row,id){
 const summary=collectDispatchRestockEstimates([{...row,id}],{branch:'Main Office'});
 return '<tr><td colspan="5" style="padding:12px">'+renderDispatchRestockEstimates(summary)+'</td></tr>';
}
export function installDispatchRestockUI(api,{document:d=globalThis.document,storage=globalThis.localStorage,dialogs=api.Swal||globalThis.Swal}={}){
 let busy=false,flowRevision=0;
 const previousDialog=dialogs.fire;
 dialogs.fire=function(options,...args){
  // SweetAlert opens asynchronously. A fast cached request can replace its
  // loading popup before didOpen runs; the stale callback must not hide the
  // review's confirmation button or show a spinner on the next dialog.
  if(options&&typeof options==='object'&&['Loading Request...','Preparing dispatch draft'].includes(options.titleText||options.title)&&typeof options.didOpen==='function'){
   const opened=options.didOpen;
   options={...options,didOpen:popup=>{if(typeof dialogs.getPopup==='function'&&dialogs.getPopup()!==popup)return;opened(popup);}};
  }
  return previousDialog.call(this,options,...args);
 };
 const context={document:d,storage},collect=()=>collectDispatchDraft(api,context);
 function baseline(draft){
  const identity=captureDispatchAuthority(api,draft),cart=api.dispatchCart,serialized=canonicalDispatchIntent(draft);
  return ()=>{const current=captureDispatchAuthority(api,draft);if(current.session!==identity.session||current.uid!==identity.uid||current.email!==identity.email||current.name!==identity.name||api.dispatchCart!==cart||canonicalDispatchIntent(collect())!==serialized)throw Error('The account, branches or draft changed. Review it before saving.');};
 }
 function clearCurrent(check,key){
  try{check();}catch{return false;}
  api.dispatchCart=[];
  for(const name of ['takodeal_dispatch_cart','takodeal_dispatch_from','takodeal_dispatch_to','takodeal_active_po',key])storage.removeItem(name);
  for(const name of Object.keys(storage))if(name.startsWith('takodeal_draft_qty_'))storage.removeItem(name);
  api.renderDispatchCart?.();return true;
 }
 async function requestLinks(draft,check){
  const issues=[];
  for(const id of draft.purchaseOrderIds){
   if(id.length>150||id.includes('/')){issues.push({id,branch:'Unknown branch',status:'Invalid link',reason:'has an invalid request link'});continue;}
   const saved=await api.getDocFromServer(api.doc(api.db,'purchase_orders',id));check();
   try{assertDispatchRequestAvailable(saved.exists()?saved.data():null,{id,source:draft.source,destination:draft.destination});}
   catch(error){if(error.code!=='DISPATCH_REQUEST_LINK')throw error;issues.push(...error.issues);}
  }
  check();
  if(issues.length){const error=Error(issues.map(row=>row.branch+' · '+row.status+': request '+row.id+' '+row.reason+'.').join('\n'));error.code='DISPATCH_REQUEST_LINK';error.issues=issues;throw error;}
 }
 async function assertNoSavedAttempt(check){
  for(const [key,table,prefix] of [['takodeal_dispatch_attempt','settings','dispatch_commit_'],['takodeal_set_aside_attempt','purchase_orders','']]){
   const pending=savedAttempt(storage,key);if(!pending)continue;
   if(typeof pending.id!=='string'||!pending.id||pending.id.length>150||pending.id.includes('/'))throw Error('A previous save attempt needs review before refreshing this draft. Keep the draft and reopen Dispatch.');
   const saved=await api.getDocFromServer(api.doc(api.db,table,prefix+pending.id));check();
   if(saved.exists())throw Error(key==='takodeal_dispatch_attempt'?'A delivery from this draft was already saved. Keep this draft and retry the unchanged delivery to confirm it, or review the delivery feed.':'A set-aside copy of this draft was already saved. Keep this draft and retry Set Aside to confirm it, or review the request list.');
  }
 }
 function draftCopy(copy){
  return '<div style="text-align:left;font-size:14px;overflow-wrap:anywhere"><p>'+esc(copy.source)+' → '+esc(copy.destination)+'</p><p>This is a reference copy of your entered quantities. Review the open request again before sending.</p><div style="max-height:40vh;overflow:auto">'+copy.items.map(row=>'<p style="padding:8px;border-bottom:1px solid #dbe5df"><strong>'+esc(row.itemName||row.name)+'</strong><br>'+esc(quantity(row.rawQty)+' '+(row.friendlyUom||row.baseUom||row.uom||'units'))+'</p>').join('')+'</div></div>';
 }
 api.showDispatchDraftBackup=async()=>{
  try{
   const uid=api.auth?.currentUser?.uid,copy=uid&&savedAttempt(storage,'takodeal_dispatch_recovery_'+uid);
   if(!copy||copy.actorUid!==uid)return dialogs.fire('No saved draft copy','A reference copy is saved when you refresh broken request links.','info');
   captureDispatchAuthority(api,{source:copy.source,destination:copy.destination});
   return dialogs.fire({titleText:'Saved quantity reference',html:draftCopy(copy),confirmButtonText:'Close',width:'620px'});
  }catch(error){return dialogs.fire('Draft copy needs attention',error.message,'warning');}
 };
 async function resetLinks(error,draft,check){
  const identity=captureDispatchAuthority(api,draft);
  const answer=await dialogs.fire({titleText:'Refresh the linked stock requests',icon:'warning',text:error.message+' Your entered quantities will be copied on this device before the draft is cleared. Then reopen the correct request. No delivery will be sent.',showCancelButton:true,confirmButtonText:'Save copy and refresh draft',cancelButtonText:'Keep my draft',confirmButtonColor:'#176552',focusConfirm:false});
  if(!answer.isConfirmed)return false;check();
  await assertNoSavedAttempt(check);check();
  // Keep the original editable quantities, not just the last persisted cart.
  // A failed backup write must leave the entire draft and its links intact.
  const copy={version:1,actorUid:identity.uid,savedAt:new Date().toISOString(),source:draft.source,destination:draft.destination,items:draft.allItems,purchaseOrderIds:draft.purchaseOrderIds,
   attempts:{dispatch:storage.getItem('takodeal_dispatch_attempt'),setAside:storage.getItem('takodeal_set_aside_attempt')}};
  storage.setItem('takodeal_dispatch_recovery_'+identity.uid,JSON.stringify(copy));check();
  const keys=['takodeal_dispatch_cart','takodeal_dispatch_from','takodeal_dispatch_to','takodeal_active_po','takodeal_dispatch_attempt','takodeal_set_aside_attempt',...Object.keys(storage).filter(key=>key.startsWith('takodeal_draft_qty_'))];
  const previous=new Map(keys.map(key=>[key,storage.getItem(key)]));
  try{for(const key of keys)storage.removeItem(key);}catch(error){for(const [key,value]of previous)try{if(value!==null)storage.setItem(key,value);}catch{}throw error;}
  api.dispatchCart=[];api.renderDispatchCart?.();await api.loadDispatchDashboard?.();
  await dialogs.fire({titleText:'Draft refreshed · quantities copied',html:draftCopy(copy),confirmButtonText:'Review stock requests',confirmButtonColor:'#176552',width:'620px'});return true;
 }
 api.resetDispatchDraftLinks=async()=>{
  if(busy)return false;let button=d.getElementById('btnSubmitDispatch');
  try{
   const draft=collect(),check=baseline(draft);busy=true;if(button)button.disabled=true;
   try{await requestLinks(draft,check);await dialogs.fire('Request links are current','This draft has no broken request links. Your quantities were kept.','info');return false;}
   catch(error){if(error.code!=='DISPATCH_REQUEST_LINK')throw error;return await resetLinks(error,draft,check);}
  }catch(error){await dialogs.fire('Draft was kept',error.message,'warning');return false;}
  finally{busy=false;if(button)button.disabled=false;}
 };
 // Older Approve shortcuts must use the same reviewed, validated cart loader.
 api.approvePurchaseOrder=(...args)=>api.reviewPurchaseOrder(...args);
 const previousRender=api.renderDispatchCart;
 api.renderDispatchCart=function(...args){
  const result=previousRender?.apply(this,args),button=d.getElementById('btnSubmitDispatch');
  if(!button?.parentNode||typeof d.createElement!=='function')return result;
  d.getElementById('dispatchDraftRecoveryActions')?.remove();
  const uid=api.auth?.currentUser?.uid,hasCopy=uid&&storage.getItem('takodeal_dispatch_recovery_'+uid);
  if(!hasCopy&&(!api.dispatchCart?.length||!ids(storage).length))return result;
  const actions=d.createElement('div');actions.id='dispatchDraftRecoveryActions';actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';
  for(const [label,action,visible] of [['Refresh request links',api.resetDispatchDraftLinks,api.dispatchCart?.length&&ids(storage).length],['View saved quantity reference',api.showDispatchDraftBackup,hasCopy]]){
   if(!visible)continue;const control=d.createElement('button');control.type='button';control.textContent=label;control.style.cssText='min-height:44px;padding:10px 14px;border:1px solid #cad8d1;border-radius:8px;background:#f7faf6;color:#176552;cursor:pointer;';control.onclick=action;actions.appendChild(control);
  }
  button.parentNode.insertBefore(actions,button.nextSibling);return result;
 };
 const previousSubmit=api.submitMultiDispatch;
 api.submitMultiDispatch=async()=>{
  if(busy)return;let button=d.getElementById('btnSubmitDispatch'),draft,check,committed=false;
  try{
   draft=collect();check=baseline(draft);
   if(api.sessionUser.isFranchisee){check();busy=true;return await previousSubmit();}
   if(!draft.items.length)throw Error('Add an item with a quantity greater than zero.');
   busy=true;if(button)button.disabled=true;
   const identity=captureDispatchAuthority(api,draft),signature=canonicalDispatchIntent({...draft,actorUid:identity.uid,actorEmail:identity.email});
   let pending=savedAttempt(storage,'takodeal_dispatch_attempt');
   // A failed/ambiguous attempt is retried with its original ID, driver and preview.
   // Changing it requires a server check, never silently inventing another delivery.
   if(pending&&pending.signature!==signature){
    const saved=await api.getDocFromServer(api.doc(api.db,'settings','dispatch_commit_'+pending.id));check();
    if(saved.exists())throw Error('Your previous delivery was already saved. Review the delivery feed before sending this changed draft.');
    storage.removeItem('takodeal_dispatch_attempt');pending=null;
   }
   // A same-ID retry may already be committed. Let commitDispatch acknowledge
   // it before inspecting the now-Completed requests, without another send.
   if(!pending)await requestLinks(draft,check);
   let plan=pending?.payload?.autoRestock??await prepareDispatchRestock(api,draft);check();
   const answer=await dialogs.fire({title:pending?'Retry saved delivery':'Send delivery to '+draft.destination,html:preview(plan),input:'text',inputLabel:'Driver / person delivering',inputValue:pending?.payload?.driver||'',inputPlaceholder:'Enter the driver’s name',showCancelButton:true,confirmButtonText:pending?'Retry same delivery':'Send delivery',confirmButtonColor:'#176552',inputValidator:value=>!String(value||'').trim()?'Enter the driver’s name.':undefined});
   if(!answer.isConfirmed)return;check();
   const driver=String(answer.value||'').trim();if(!driver)throw Error('Enter the driver’s name.');
   if(pending&&driver!==pending.payload.driver)throw Error('Retry this delivery with its saved driver name. Review the feed before changing an earlier attempt.');
   if(!pending){pending={version:1,id:'dispatch-'+api.crypto.randomUUID(),signature,payload:{source:draft.source,destination:draft.destination,driver,actor:identity.name,items:draft.items,skipped:draft.skipped,purchaseOrderIds:draft.purchaseOrderIds,autoRestock:plan}};storage.setItem('takodeal_dispatch_attempt',JSON.stringify(pending));}
   if(button)button.textContent='Saving restock and delivery…';
   await commitDispatch(api,{id:pending.id,...pending.payload,assertCurrent:check});
   committed=true;
   const cleared=clearCurrent(check,'takodeal_dispatch_attempt');
   api.invalidateCache?.('inventory');api.invalidateCache?.('hq_restocks');
   if(cleared)await api.loadDispatchDashboard?.();else api.loadDispatchLogs?.();
   api.ManagerUI?.notify(cleared?'Delivery saved. The cashier confirms receipt at the destination.':'Delivery saved. Your newer draft was kept. Review the delivery feed.');
  }catch(error){
   if(!committed&&error.code==='DISPATCH_REQUEST_LINK'&&draft&&check){try{check();await resetLinks(error,draft,check);}catch(recovery){await dialogs.fire('Draft was kept',recovery.message,'warning');}}
   else await dialogs.fire(committed?'Delivery saved':'Delivery was not sent',committed?'The delivery and its restock were saved. Refresh the delivery feed to see them.':error.message,committed?'info':'error');
  }
  finally{busy=false;if(button){button.disabled=false;button.textContent=api.sessionUser?.isFranchisee?'Request stock from HQ':'Send delivery';}}
 };
 api.clearDispatchCart=async()=>{
  if(busy)return;
  if(!api.dispatchCart?.length){for(const name of ['takodeal_dispatch_cart','takodeal_dispatch_from','takodeal_dispatch_to','takodeal_active_po'])storage.removeItem(name);api.renderDispatchCart?.();return;}
  let button=d.getElementById('btnSubmitDispatch'),committed=false;
  try{
   const draft=collect(),check=baseline(draft),identity=captureDispatchAuthority(api,draft);busy=true;if(button)button.disabled=true;
   const signature=canonicalDispatchIntent({source:draft.source,destination:draft.destination,items:draft.allItems,purchaseOrderIds:draft.purchaseOrderIds,actorUid:identity.uid,actorEmail:identity.email});
   let pending=savedAttempt(storage,'takodeal_set_aside_attempt');
   if(pending&&pending.signature!==signature){
    const saved=await api.getDocFromServer(api.doc(api.db,'purchase_orders',pending.id));check();
    if(saved.exists())throw Error('An earlier draft was already saved. Review the request list before saving this changed draft.');
    storage.removeItem('takodeal_set_aside_attempt');pending=null;
   }
   if(!pending){pending={version:1,id:'setaside-'+api.crypto.randomUUID(),signature};storage.setItem('takodeal_set_aside_attempt',JSON.stringify(pending));}
   await commitSetAside(api,{id:pending.id,source:draft.source,destination:draft.destination,actor:{uid:identity.uid,email:identity.email,name:identity.name},items:draft.allItems,purchaseOrderIds:draft.purchaseOrderIds,assertCurrent:check});
   committed=true;
   const cleared=clearCurrent(check,'takodeal_set_aside_attempt');api.loadDispatchLogs?.();
   await dialogs.fire('Draft saved',draft.source+' → '+draft.destination+'. The original requests are retained.'+(cleared?'':' Your newer draft was kept.'),'success');
  }catch(error){await dialogs.fire(committed?'Draft saved':'Draft was not saved',committed?'The draft was saved. Refresh the request list to see it.':error.message,committed?'info':'error');}
  finally{busy=false;if(button)button.disabled=false;}
 };
 const previousRevert=api.revertAndEditRestock;
 api.revertAndEditRestock=async encoded=>{
  try{
   const input=JSON.parse(decodeURIComponent(encoded));
   const fresh=await api.getDocFromServer(api.doc(api.db,'hq_restocks',input.id));
   if(!fresh.exists())throw Error('This restock record is missing. Refresh the invoices.');
   if(isDispatchAutoRestock(fresh.data()))throw Error('This estimate is linked to a saved delivery. It cannot be undone with Revert & Edit. Review the delivery and its stock correction records.');
   return await previousRevert(encodeURIComponent(JSON.stringify({...fresh.data(),id:input.id})));
  }catch(error){await dialogs.fire('Restock needs review',error.message,'warning');}
 };
 const previousFlow=api.loadFinancialFlow;
 api.loadFinancialFlow=async()=>{
  const revision=++flowRevision,session=api.sessionUser,uid=api.auth?.currentUser?.uid;
  await previousFlow();
  if(revision!==flowRevision||api.sessionUser!==session||api.auth?.currentUser?.uid!==uid||!session||session.isFranchisee||!canOpenWorkspacePage(session,'financial-flow'))return;
  const container=d.getElementById('financialFlowchartContainer'),branch=d.getElementById('flowBranchFilter')?.value;
  const period=d.getElementById('flowTimeFilter')?.value,month=d.getElementById('flowMonthPicker')?.value,year=d.getElementById('flowYearPicker')?.value;
  const currentReport=()=>revision===flowRevision&&api.sessionUser===session&&api.auth?.currentUser?.uid===uid&&!session.isFranchisee&&canOpenWorkspacePage(session,'financial-flow')&&branch===d.getElementById('flowBranchFilter')?.value&&period===d.getElementById('flowTimeFilter')?.value&&month===d.getElementById('flowMonthPicker')?.value&&year===d.getElementById('flowYearPicker')?.value;
  let start,end;
  if(period==='month'){const [y,m]=String(month).split('-').map(Number);start=new Date(y,m-1,1);end=new Date(y,m,0,23,59,59,999);}else{start=new Date(Number(year),0,1);end=new Date(Number(year),11,31,23,59,59,999);}
  try{
   const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_restocks'),api.where('timestamp','>=',start),api.where('timestamp','<=',end)));
   if(!currentReport())return;
   const summary=collectDispatchRestockEstimates(snap.docs.map(row=>({...row.data(),id:row.id})),{start,end,branch});
   container?.insertAdjacentHTML('beforeend',renderDispatchRestockEstimates(summary));
  }catch{if(currentReport())container?.insertAdjacentHTML('beforeend','<p role="status">Automatic restock estimates could not be loaded. Refresh Financial Flow when connected.</p>');}
 };
 return {preview};
}
