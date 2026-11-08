import {normalizeStaffPayslip,payslipCutoffKey} from './staff-payslip-snapshot.js';
const text=value=>typeof value==='string'?value.trim():'';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=value=>value?.toMillis?.()??(value?.seconds!=null?value.seconds*1000:Date.parse(value));
const deadline=promise=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Saved payslips took too long to load. Reconnect and refresh Pay.')),20000);})]).finally(()=>clearTimeout(timer));};
function rows(result){
  if(result?.metadata?.fromCache||result?.metadata?.hasPendingWrites)throw Error('Reconnect to confirm the saved Owner payslips.');
  const list=Array.isArray(result?.docs)?result.docs:null;if(!list||list.length>250)throw Error('Saved payslip history is incomplete or too large. Ask HQ to confirm the exact cutoff.');
  return list.map(row=>{if(row.metadata?.fromCache||row.metadata?.hasPendingWrites)throw Error('A saved payslip is still syncing.');return {...row.data(),id:row.id};});
}
export async function readStaffSavedPayslips(api,{staffId,staffName,profile={},createVault,assertCurrent=()=>{}}={}){
  const aliases=[...new Set([staffName,profile.cashierName,profile.fullName,profile.name,profile.scheduleNickname,profile.scheduleName,profile.nickname,...(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[])].map(text).filter(Boolean))];
  const guard=()=>assertCurrent();guard();
  const queryPaid=(field,value,op='==')=>deadline(api.getDocsFromServer(api.query(api.collection(api.db,'payroll_records'),api.where(field,op,value),...(api.limit?[api.limit(251)]:[])))).then(result=>{guard();return rows(result);});
  if(aliases.length>10)throw Error('The saved payroll names need HQ confirmation before loading this vault.');
  const jobs=['staffId','frozenData.staffId','frozenData.profile.staffId','frozenData.profile.id'].map(field=>queryPaid(field,staffId));
  if(aliases.length)jobs.push(queryPaid('staffName',aliases,'in'),queryPaid('frozenData.name',aliases,'in'));
  const paidResults=await Promise.allSettled(jobs);guard();
  const paidRows=[...new Map(paidResults.flatMap(result=>result.status==='fulfilled'?result.value:[]).map(row=>[row.id,row])).values()];
  const ownRows=paidRows.filter(row=>{
    const ids=[row.staffId,row.frozenData?.staffId,row.frozenData?.profile?.staffId,row.frozenData?.profile?.id].filter(Boolean);
    return ids.length?ids.includes(staffId):aliases.includes(text(row.staffName||row.frozenData?.name));
  });
  const legacyNames=[];
  for(const name of [...new Set(ownRows.filter(row=>![row.staffId,row.frozenData?.staffId,row.frozenData?.profile?.staffId,row.frozenData?.profile?.id].some(Boolean)).map(row=>text(row.staffName||row.frozenData?.name)))]){
    try{const result=await deadline(api.getDocsFromServer(api.query(api.collection(api.db,'cashiers'),api.where('cashierName','==',name),...(api.limit?[api.limit(2)]:[]))));guard();if(!result.metadata?.fromCache&&!result.metadata?.hasPendingWrites&&result.docs?.length===1&&result.docs[0].id===staffId)legacyNames.push(name);}catch{guard();}
  }
  let sharedRows=[],sharedError='';
  try{
    const client=await deadline(createVault());guard();const user=client.auth?.currentUser,uid=user?.uid;if(!uid)throw Error('Reconnect the approved private Staff phone to read Owner-shared payslips.');
    const same=()=>{guard();if(client.auth.currentUser!==user||client.auth.currentUser?.uid!==uid)throw Error('The private Staff account changed.');};
    const sdk=client.sdk,access=await deadline(sdk.getDocFromServer(sdk.doc(client.db,'staff_document_devices',uid)));same();
    const binding=access?.exists?.()?access.data():null;
    if(access.metadata?.fromCache||access.metadata?.hasPendingWrites||binding?.active!==true||binding.uid!==uid||binding.staffId!==staffId)throw Error('Ask HQ to approve this phone for private payslips.');
    const result=await deadline(sdk.getDocsFromServer(sdk.query(sdk.collection(client.db,'staff_payslip_previews'),sdk.where('staffId','==',staffId),...(sdk.limit?[sdk.limit(251)]:[]))));same();sharedRows=rows(result);
  }catch(error){guard();sharedError=error.message;}
  const state={paid:[],shared:[],held:[],errors:[],paidComplete:paidResults.every(result=>result.status==='fulfilled')};
  if(!state.paidComplete)state.errors.push('Saved paid payroll could not be fully confirmed. Owner-shared drafts are held until payment records can be checked.');
  if(sharedError)state.errors.push(sharedError);
  for(const record of ownRows){try{state.paid.push({record,data:normalizeStaffPayslip(record,{staffId,legacyNames})});}catch(error){state.held.push({record,message:error.message});}}
  const cutoffCounts=new Map();for(const entry of state.paid){const key=payslipCutoffKey(entry.data);cutoffCounts.set(key,(cutoffCounts.get(key)||0)+1);}
  state.paid=state.paid.filter(entry=>{if(cutoffCounts.get(payslipCutoffKey(entry.data))===1)return true;state.held.push({record:entry.record,message:'More than one saved payment covers this cutoff. Ask HQ to confirm the original payslip.'});return false;});
  const paidCutoffs=new Set([...state.paid.map(entry=>payslipCutoffKey(entry.data)),...ownRows.map(row=>JSON.stringify([row.startDate??row.frozenData?.start??row.frozenData?.startDate,row.endDate??row.frozenData?.end??row.frozenData?.endDate]))]);
  if(state.paidComplete)for(const record of sharedRows){
    if(record.staffId!==staffId)continue;
    if(paidCutoffs.has(JSON.stringify([record.startDate,record.endDate])))continue;
    try{state.shared.push({record,data:normalizeStaffPayslip(record,{staffId},{shared:true})});}catch(error){state.held.push({record,message:error.message});}
  }
  state.paid.sort((a,b)=>(stamp(b.record.processedAt)||0)-(stamp(a.record.processedAt)||0));
  state.shared.sort((a,b)=>b.data.end.localeCompare(a.data.end));guard();return state;
}
export function installStaffSavedPayslipViews(w,d){
  if(w.staffSavedPayslipViews)return w.staffSavedPayslipViews;
  let registry=new Map(),scope=null;const hidden=new Map();
  const current=()=>scope&&w.localStorage.getItem('takodeal_staff_id')===scope.staffId&&w.staffVaultSession?.allows(scope.staffId,scope.epoch);
  const encode=data=>encodeURIComponent(JSON.stringify(data)).replace(/'/g,'%27');
  const restoreLive=()=>{for(const [node,value]of hidden)node.hidden=value;hidden.clear();};
  const clear=()=>{registry.clear();scope=null;restoreLive();d.getElementById('staffAuthoritativePayslip')?.remove?.();for(const id of ['payslipPendingList','payslipHistoryList']){const node=d.getElementById(id);if(node)node.innerHTML='';}};
  w.clearStaffSavedPayslips=clear;
  w.viewSavedStaffPayslip=key=>{if(!current())return;const entry=registry.get(key);if(entry)return w.viewPastPayslip(encode(entry.data));};
  w.signSavedStaffPayslip=key=>{if(!current())return;const entry=registry.get(key);if(entry?.data.recordState==='paid'&&entry.record.acknowledged===false)return w.openPayslipSignatureModal(entry.record.id,encode(entry.data));};
  function render(state,{staffId,epoch,start,end,processingHTML='',processingCount=0}={}){
    scope={staffId,epoch};if(!current())return;registry=new Map();restoreLive();let pending=processingHTML,past='',count=processingCount;
    const card=(entry,shared)=>{
      const key=(shared?'shared:':'paid:')+entry.record.id;registry.set(key,entry);const token=encodeURIComponent(key).replace(/'/g,'%27'),needsSign=!shared&&entry.record.acknowledged===false;
      if(needsSign)count++;
      return '<article style="background:white;border:1px solid #cbded0;border-radius:12px;padding:16px;margin-bottom:14px"><h3 style="margin:0 0 8px;font-size:15px">Cutoff: '+escape(entry.data.start)+' to '+escape(entry.data.end)+'</h3><p style="font-size:12px;line-height:1.5">'+(shared?'Owner-shared payslip · Payment pending. These are the exact saved Owner figures; this is not a payment or a signature request.':needsSign?'Paid payslip · Signature required':entry.record.acknowledged===true?'Paid payslip · Acknowledged':'Paid payslip · Saved record; acknowledgment not recorded')+'</p><strong style="font-size:20px">Net: '+money(entry.data.finalNetPay)+'</strong><p style="font-size:12px">Gross: '+money(entry.data.grossPay)+' · Deductions: '+money(entry.data.totalDeductions)+'</p><button type="button" class="btn-outline" data-saved-view="'+escape(token)+'">View '+(shared?'shared payslip':'saved record')+'</button>'+(needsSign?' <button type="button" class="btn-primary" data-saved-sign="'+escape(token)+'">Review & sign</button>':'')+'</article>';
    };
    for(const entry of state.shared)pending+=card(entry,true);
    for(const entry of state.paid){const html=card(entry,false);if(entry.record.acknowledged===false)pending+=html;else past+=html;}
    const warning=state.errors.map(message=>'<p role="status" style="padding:12px;background:#fff8e8;border:1px solid #ead6ad;border-radius:8px">'+escape(message)+'</p>').join('');
    for(const held of state.held)pending+='<p role="status" style="padding:12px;background:#fff8e8;border:1px solid #ead6ad;border-radius:8px">Saved payslip needs HQ review. '+escape(held.message)+'</p>';
    const pendingList=d.getElementById('payslipPendingList'),history=d.getElementById('payslipHistoryList');
    if(pendingList)pendingList.innerHTML=warning+pending||'<p>No pending payslips.</p>';
    if(history)history.innerHTML=warning+past||'<p>No past payslips found.</p>';
    const badge=d.getElementById('pendingPayBadge');if(badge){badge.innerText=String(count+state.shared.length+state.held.length);badge.style.display=Number(badge.innerText)>0?'inline-block':'none';}
    const live=d.getElementById('payslipLiveSection'),selected=[...state.paid,...state.shared].find(entry=>entry.data.start===start&&entry.data.end===end);
    const heldCurrent=state.held.find(entry=>(entry.record.startDate??entry.record.frozenData?.start??entry.record.frozenData?.startDate??entry.record.snapshot?.start)===start&&(entry.record.endDate??entry.record.frozenData?.end??entry.record.frozenData?.endDate??entry.record.snapshot?.end)===end);
    let loadStatus=d.getElementById('staffSavedPayslipStatus');
    if(live&&state.errors.length&&!loadStatus&&d.createElement){loadStatus=d.createElement('p');loadStatus.id='staffSavedPayslipStatus';loadStatus.setAttribute?.('role','status');live.prepend(loadStatus);}
    if(loadStatus){loadStatus.textContent=state.errors.join(' ');loadStatus.hidden=!state.errors.length;}
    let authoritative=d.getElementById('staffAuthoritativePayslip');
    if((selected||heldCurrent)&&live){if(!authoritative){authoritative=d.createElement('div');authoritative.id='staffAuthoritativePayslip';live.prepend(authoritative);}authoritative.innerHTML=selected?card(selected,selected.data.recordState==='shared'):'<p role="status" style="padding:16px;background:#fff8e8;border:1px solid #ead6ad;border-radius:10px">The saved payslip for this cutoff needs HQ review. '+escape(heldCurrent.message)+' A live estimate cannot replace its saved figures.</p>';authoritative.hidden=false;
      for(const node of live.children||[])if(node!==authoritative&&node.id!=='staffRefreshPay'){hidden.set(node,node.hidden);node.hidden=true;}
    }else authoritative?.remove?.();
    const tab=d.getElementById('btnTabLivePay');if(tab)tab.textContent=selected||heldCurrent?'Current Payslip':'Live Estimate';
    for(const parent of [pendingList,history,authoritative]){
      parent?.querySelectorAll?.('[data-saved-view]').forEach(button=>{button.onclick=()=>w.viewSavedStaffPayslip(decodeURIComponent(button.dataset.savedView));});
      parent?.querySelectorAll?.('[data-saved-sign]').forEach(button=>{button.onclick=()=>w.signSavedStaffPayslip(decodeURIComponent(button.dataset.savedSign));});
    }
  }
  const controller={render,clear,restoreLive};w.staffSavedPayslipViews=controller;return controller;
}
