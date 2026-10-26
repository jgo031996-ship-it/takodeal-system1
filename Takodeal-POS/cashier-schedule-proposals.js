import {loadScheduleMonthView} from './schedule-sync.js';
import {scheduleDateKey} from './schedule-history.js';
import {scheduleProposalContext,normalizeScheduleProposal} from './schedule-proposal-model.js';
export const SCHEDULE_PROPOSAL_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/branchScheduleProposals';
const codeKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure='HQ has not confirmed this proposal. Keep this draft and retry the same submission.';
export async function withScheduleProposalDeadline(work,{timeoutMs=20000,Controller=AbortController,delay=setTimeout,cancelDelay=clearTimeout,assertCurrent=()=>{}}={}){
 const controller=new Controller();let expired=false,timer;
 const guard=()=>{if(expired)throw Error('The connection took too long. '+failure);assertCurrent();};
 try{return await Promise.race([Promise.resolve().then(()=>{guard();return work({signal:controller.signal,guard});}),new Promise((_,reject)=>{timer=delay(()=>{expired=true;controller.abort();reject(Error('The connection took too long. '+failure));},timeoutMs);})]);}
 finally{expired=true;controller.abort();cancelDelay(timer);}
}
export function createScheduleProposalTransport({auth,fetcher=fetch,timeoutMs=20000,Controller,delay,cancelDelay}={}){
 const deadline={timeoutMs,...(Controller?{Controller}:{}),...(delay?{delay}:{}),...(cancelDelay?{cancelDelay}:{})};
 return {async submit({staffId,pin,operationId,proposal,uid,assertCurrent=()=>{}}){
  if(!codeKey(staffId)||!codeKey(operationId)||typeof pin!=='string'||!pin.trim()||pin.length>100||!object(proposal)||!codeKey(proposal.id))throw Error('Enter your current staff PIN and check the saved proposal.');
  const body={staffId,pin,operationId,proposal};
  return withScheduleProposalDeadline(async({signal,guard})=>{
   if(typeof auth?.authStateReady==='function')await auth.authStateReady();guard();
   const user=auth?.currentUser;if(!user?.uid||user.uid!==uid||user.isAnonymous!==true)throw Error('This tablet needs its secure Cashier device approval. Ask HQ to check it in Device Fleet.');
   const token=await user.getIdToken();guard();if(auth.currentUser!==user||!token)throw Error('The tablet account changed. Reopen Branch Schedule.');
   const response=await fetcher(SCHEDULE_PROPOSAL_ENDPOINT+'/submit',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal,cache:'no-store',redirect:'error',credentials:'omit'});guard();
   const result=await response.json();guard();if(auth.currentUser!==user)throw Error('The tablet account changed. Reopen Branch Schedule.');
   if(!response.ok){const message=typeof result?.message==='string'&&result.message.length<=1000?result.message:failure;const error=Error(message);error.code=typeof result?.code==='string'?result.code:'proposal-unconfirmed';error.status=response.status;throw error;}
   if(!object(result)||result.id!==proposal.id||!['Pending','Approved','Rejected'].includes(result.status)||typeof result.submittedAt!=='string'||!Number.isFinite(Date.parse(result.submittedAt)))throw Error(failure);
   return {id:result.id,status:result.status,submittedAt:result.submittedAt};
  },{...deadline,assertCurrent});
 }};
}
export function createScheduleProposalSession(w,auth){
 const sessions=new WeakMap();let sequence=0;
 const current=()=>{const user=w.sessionUser;if(user&&!sessions.has(user))sessions.set(user,++sequence);return {session:user,uid:auth?.currentUser?.uid,staffId:user?.staffId,name:user?.cashierName,profileBranch:user?.branch,branch:w.localStorage.getItem('takodeal_device_branch'),deviceId:w.localStorage.getItem('takodeal_device_id'),sessionId:user&&sessions.get(user)};};
 const signature=row=>JSON.stringify([row.uid,row.staffId,row.name,row.profileBranch,row.branch,row.deviceId,row.sessionId]);
 function capture(includeAuth){const row=current();if(includeAuth&&!row.uid||!codeKey(row.staffId)||!row.name?.trim()||!row.branch||row.branch!==row.profileBranch||!row.deviceId)throw Error('Sign in with your own staff account on the approved branch tablet first.');
  const key=signature({...row,...(!includeAuth?{uid:null}:{})});return {...row,assertCurrent:()=>{if(signature({...current(),...(!includeAuth?{uid:null}:{})})!==key)throw Error('The cashier, tablet or branch changed. Reopen Branch Schedule before continuing.');}};
 }
 return {capture:()=>capture(true),captureStaff:()=>capture(false)};
}
const freshSnapshot=snapshot=>{if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites||snapshot.docs?.some(doc=>doc.metadata?.fromCache||doc.metadata?.hasPendingWrites))throw Error('Reconnect to HQ to confirm this tablet’s saved approval.');return snapshot;};
// Existing rules permit an anonymous UID to request Pending approval only.
// An Active public device row never grants this private UID approval by itself.
export function createScheduleProposalDeviceGate({api,auth,signInAnonymously,timeoutMs=20000,Controller,delay,cancelDelay}={}){
 const deadline={timeoutMs,...(Controller?{Controller}:{}),...(delay?{delay}:{}),...(cancelDelay?{cancelDelay}:{})};
 const bindingData=(value,uid,permit)=>{
  if(!object(value)||value.uid!==uid||value.deviceId!==permit.deviceId||value.branch!==permit.branch||!codeKey(value.legacyDeviceDocId))throw Error('This secure tablet record does not match the selected branch and device. Ask the Owner to check Device Fleet.');
  if(!['Pending','Active'].includes(value.status))throw Error('This tablet’s secure approval was revoked or blocked. Ask the Owner to review Device Fleet; it cannot request approval again.');
  return value;
 };
 const fleetData=(value,permit)=>object(value)&&value.deviceId===permit.deviceId&&value.branch===permit.branch&&value.status==='Active'&&String(value.appType||'').trim().toLowerCase()!=='staff';
 return {async check({permit,request=false,assertCurrent=()=>{}}){
  return withScheduleProposalDeadline(async({guard})=>{
   permit.assertCurrent();if(typeof auth?.authStateReady==='function')await auth.authStateReady();guard();permit.assertCurrent();
   let user=auth?.currentUser;
   if(!user){if(typeof signInAnonymously!=='function')throw Error('Secure tablet setup is unavailable. Ask HQ to update the Cashier app.');const signed=await signInAnonymously(auth);guard();permit.assertCurrent();user=signed?.user;if(!user||auth.currentUser!==user)throw Error('The tablet account changed during setup. Reopen Branch Schedule.');}
   if(!user?.uid||user.isAnonymous!==true)throw Error('A Google account is signed in on this Cashier tablet. Ask HQ to check the tablet setup. Your Google account has been kept signed in.');
   const current=()=>{guard();permit.assertCurrent();if(auth.currentUser!==user)throw Error('The tablet account changed. Reopen Branch Schedule.');};
   const reference=api.doc(api.db,'pos_bindings',user.uid),saved=freshSnapshot(await api.getDocFromServer(reference));current();
   if(saved.exists()){
    const binding=bindingData(saved.data(),user.uid,permit);
    const fleet=freshSnapshot(await api.getDocFromServer(api.doc(api.db,'pos_devices',binding.legacyDeviceDocId)));current();
    if(!fleet.exists()||!fleetData(fleet.data(),permit))throw Error('The original branch tablet registration is no longer active. Ask the Owner to check Device Fleet.');
    return {status:binding.status,uid:user.uid,deviceName:binding.deviceName||'Branch tablet'};
   }
   if(!request)return {status:'Missing',uid:user.uid};
   const rows=freshSnapshot(await api.getDocsFromServer(api.query(api.collection(api.db,'pos_devices'),api.where('deviceId','==',permit.deviceId),api.limit(10))));current();
   const matches=rows.docs.filter(row=>fleetData(row.data(),permit));
   if(rows.docs.length>=10||matches.length!==1)throw Error('HQ must confirm one active Cashier registration for this tablet and branch in Device Fleet before secure approval can be requested.');
   const mirror=matches[0];if(!codeKey(mirror.id))throw Error('The saved tablet registration needs HQ review.');
   const name=String(mirror.data().deviceName||'Branch tablet').trim().slice(0,120)||'Branch tablet';
   await api.runTransaction(api.db,async transaction=>{
    current();const prior=await transaction.get(reference);current();if(prior.exists()){bindingData(prior.data(),user.uid,permit);return;}
    const live=await transaction.get(api.doc(api.db,'pos_devices',mirror.id));current();if(!live.exists()||!fleetData(live.data(),permit))throw Error('The branch tablet registration changed. Ask the Owner to check Device Fleet.');
    transaction.set(reference,{uid:user.uid,deviceId:permit.deviceId,deviceName:name,branch:permit.branch,legacyDeviceDocId:mirror.id,status:'Pending',requestedAt:api.serverTimestamp()});
   });current();
   const confirmed=freshSnapshot(await api.getDocFromServer(reference));current();if(!confirmed.exists())throw Error('HQ has not confirmed this approval request. Check the saved approval before retrying.');
   const binding=bindingData(confirmed.data(),user.uid,permit);return {status:binding.status,uid:user.uid,deviceName:binding.deviceName||name};
  },{...deadline,assertCurrent:()=>{permit.assertCurrent();assertCurrent();}});
 }};
}
// Field masks keep PINs, salaries, identity documents and full profiles out of the editor.
export async function readScheduleProposalDirectory({auth,projectId,apiKey,branch,uid,fetcher=fetch,assertCurrent=()=>{},timeoutMs=20000,Controller,delay,cancelDelay}={}){
 if(!/^[a-z0-9-]{1,100}$/.test(projectId||''))throw Error('The staff directory is unavailable. Ask HQ to check the app.');
 return withScheduleProposalDeadline(async({signal,guard})=>{
  const user=auth?.currentUser;if(!user?.uid||user.uid!==uid)throw Error('Reconnect the approved branch tablet.');const token=await user.getIdToken();guard();
  let pageToken='';const rows=[];
  for(let page=0;page<20;page++){
   const params=new URLSearchParams({key:apiKey||'',pageSize:'100'});for(const field of ['cashierName','scheduleNickname','branch','status','active','blocked','archived'])params.append('mask.fieldPaths',field);if(pageToken)params.set('pageToken',pageToken);
   const response=await fetcher(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/cashiers?${params}`,{method:'GET',headers:{Authorization:'Bearer '+token},signal,cache:'no-store',redirect:'error',credentials:'omit'});guard();
   const data=await response.json();guard();if(auth.currentUser!==user)throw Error('The tablet account changed. Reopen Branch Schedule.');if(!response.ok)throw Error('The staff list could not be confirmed. Reconnect and load the saved roster again.');
   for(const doc of data.documents||[]){const f=doc.fields||{},staffId=doc.name?.split('/').pop();if(!codeKey(staffId))throw Error('A staff account needs HQ review.');if(f.branch?.stringValue!==branch)continue;rows.push({staffId,name:f.cashierName?.stringValue||'',scheduleName:f.scheduleNickname?.stringValue||f.cashierName?.stringValue||'',branch,status:f.status?.stringValue||'',active:f.active?.booleanValue!==false,blocked:f.blocked?.booleanValue===true,archived:f.archived?.booleanValue===true});}
   pageToken=data.nextPageToken||'';if(!pageToken)return rows;
  }
  throw Error('The staff list is too large. Ask HQ to review the directory.');
 },{timeoutMs,assertCurrent,...(Controller?{Controller}:{}),...(delay?{delay}:{}),...(cancelDelay?{cancelDelay}:{})});
}
export function proposalDaysFromChoices(context,choices){
 return context.days.map(day=>{const proposed={date:day.date,scheduled:day.shifts.map(shift=>({shiftId:shift.shiftId,staffId:null})),standbyStaffIds:[],offStaffIds:[]};
  for(const person of context.staff){const value=choices(day.date,person.staffId);if(!value)continue;if(value==='standby')proposed.standbyStaffIds.push(person.staffId);else if(value==='off')proposed.offStaffIds.push(person.staffId);else{const slot=proposed.scheduled.find(row=>'shift:'+row.shiftId===value);if(!slot)throw Error('Choose an existing HQ shift.');if(slot.staffId)throw Error('Only one staff member can fill a shift slot. Choose Standby for a reliever.');slot.staffId=person.staffId;}}
  return proposed;
 });
}
export function installCashierScheduleProposals(w,d,{primaryAuth,signInAnonymously,projectId,apiKey,fetcher=w.fetch?.bind(w),readMonth=loadScheduleMonthView,readDirectory=readScheduleProposalDirectory,timeoutMs=20000,now=()=>new Date(),deviceGate,deviceContext}={}){
 if(w.cashierScheduleProposals)return w.cashierScheduleProposals;
 const container=d.getElementById('cashierScheduleContainer');if(!container)return null;
 const staffSession=createScheduleProposalSession(w,null);
 let selectedAuth=primaryAuth,session=createScheduleProposalSession(w,primaryAuth),transport=createScheduleProposalTransport({auth:primaryAuth,fetcher,timeoutMs}),gate=deviceGate||createScheduleProposalDeviceGate({api:w,auth:primaryAuth,signInAnonymously,timeoutMs});
 const element=(tag,text,className)=>{const node=d.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 const panel=element('section',undefined,'schedule-proposal-launch'),heading=element('div'),openButton=element('button','Propose schedule changes');openButton.type='button';heading.append(element('strong','Need to change this branch’s roster?'),element('p','Send assignments to the Owner for review. The saved roster changes only after approval.'));panel.append(heading,openButton);container.before(panel);
 const dialog=element('dialog',undefined,'schedule-proposal-dialog');dialog.setAttribute('aria-labelledby','scheduleProposalTitle');
 dialog.innerHTML='<form class="schedule-proposal-form"><header><div><small>BRANCH SCHEDULE · OWNER REVIEW</small><h2 id="scheduleProposalTitle">Propose schedule changes</h2><p data-proposal-identity></p></div><button type="button" data-proposal-close aria-label="Close schedule proposal">×</button></header><div class="schedule-proposal-body"><p class="schedule-proposal-help">HQ shift times and approved leave stay as saved. Assign staff to existing shifts, Standby or Day Off. No Time In, Time Out or pay record is changed by this request.</p><div class="schedule-proposal-dates"><label>From<input type="date" data-proposal-from required></label><label>To<input type="date" data-proposal-to required></label><button type="button" data-proposal-load>Load saved roster</button></div><p data-proposal-status role="status" aria-live="polite"></p><div data-proposal-days></div><label>Reason for the change<textarea data-proposal-reason maxlength="1500" rows="3" placeholder="For example, emergency cover for a staff member who is sick." required></textarea></label><label>Your staff PIN<input type="password" data-proposal-pin inputmode="numeric" autocomplete="off" maxlength="100" placeholder="Confirm with your current Cashier PIN" required></label><p class="schedule-proposal-help">Submit as yourself. Your PIN is checked by HQ and is not saved with the proposal.</p></div><footer><button type="button" data-proposal-close>Cancel</button><button type="submit" data-proposal-submit disabled>Send for Owner review</button></footer></form>';
 d.body.append(dialog);const find=selector=>dialog.querySelector(selector),form=find('form'),from=find('[data-proposal-from]'),to=find('[data-proposal-to]'),pin=find('[data-proposal-pin]'),reason=find('[data-proposal-reason]'),daysNode=find('[data-proposal-days]'),send=find('[data-proposal-submit]'),load=find('[data-proposal-load]'),status=find('[data-proposal-status]');
 const approval=element('section',undefined,'schedule-proposal-approval'),approvalText=element('p'),approvalUid=element('p',undefined,'schedule-proposal-help'),requestApproval=element('button','Request secure tablet approval'),checkApproval=element('button','Check approval');requestApproval.type=checkApproval.type='button';approval.append(approvalText,approvalUid,requestApproval,checkApproval);find('.schedule-proposal-body').prepend(approval);approval.hidden=true;
 let epoch=0,permit=null,preAuth=null,deviceReady=false,view=null,context=null,busy=false,pending=null,selectors=new Map(),timer;
 const freshId=()=>{if(typeof w.crypto?.randomUUID!=='function')throw Error('This device needs a current browser before submitting schedules.');return w.crypto.randomUUID();};
 function state(message){status.textContent=message;}
 function clear(){epoch++;pin.value='';context=null;view=null;pending=null;deviceReady=false;preAuth=null;selectors.clear();daysNode.replaceChildren();send.disabled=true;busy=false;clearInterval(timer);}
 function assert(token){permit?.assertCurrent();if(!permit||token!==epoch||!dialog.open)throw Error('This schedule review closed. Reopen it before continuing.');}
 function controls(){from.disabled=to.disabled=reason.disabled=load.disabled=busy||Boolean(pending)||!deviceReady;send.disabled=busy||!context||!deviceReady;pin.disabled=busy||!deviceReady;requestApproval.disabled=checkApproval.disabled=busy;for(const input of selectors.values())input.disabled=busy||Boolean(pending)||!deviceReady;}
 function close(){clear();permit=null;dialog.close();}
 function showDays(){daysNode.replaceChildren();selectors.clear();
  for(const day of context.days){const card=element('article',undefined,'schedule-proposal-day');card.append(element('h3',new Date(day.date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'short',day:'numeric'})));
   const rules=element('p',day.shifts.map(shift=>`${shift.name}: ${shift.startTime}–${shift.endTime}`).join(' · '),'schedule-proposal-help');card.append(rules);const grid=element('div',undefined,'schedule-proposal-staff');
   for(const person of context.staff){if(day.protectedStaffIds.includes(person.staffId))continue;const label=element('label',person.name),select=element('select');select.setAttribute('aria-label',person.name+' assignment on '+day.date);
    const source=day.scheduled.find(row=>row.staffId===person.staffId),value=source?'shift:'+source.shiftId:day.standbyStaffIds.includes(person.staffId)?'standby':day.offStaffIds.includes(person.staffId)?'off':'';
    const options=[['','Not included'],...day.shifts.map(shift=>['shift:'+shift.shiftId,shift.name+' · '+shift.startTime+'–'+shift.endTime]),['standby','Standby / reliever'],['off','Day Off']];
    for(const [id,name] of options){const option=element('option',name);option.value=id;if(id===''&&day.requiredStaffIds.includes(person.staffId))option.disabled=true;select.append(option);}select.value=value;label.append(select);grid.append(label);selectors.set(day.date+'|'+person.staffId,select);
   }
   card.append(grid);for(const row of day.protected)card.append(element('p',row.name+' · '+row.status+' (HQ protected leave)','schedule-proposal-protected'));daysNode.append(card);
  }
 }
 async function loadRoster(){if(busy)return;const token=++epoch;context=null;view=null;pending=null;daysNode.replaceChildren();send.disabled=true;busy=true;controls();pin.value='';state('Confirming the saved roster and staff accounts…');
  try{permit.assertCurrent();const selectedFrom=from.value,selectedTo=to.value,today=scheduleDateKey(now());if(selectedFrom<today||selectedFrom.slice(0,7)!==selectedTo.slice(0,7)||selectedTo<selectedFrom)throw Error('Choose today or future dates within the same month.');
   const result=await Promise.all([readMonth(w,{month:selectedFrom.slice(0,7),branch:permit.branch,timeoutMs}),readDirectory({auth:selectedAuth,projectId,apiKey,branch:permit.branch,uid:permit.uid,fetcher,timeoutMs,assertCurrent:()=>assert(token)})]);assert(token);
   view=result[0];context=scheduleProposalContext({monthView:view,staff:result[1],branch:permit.branch,from:selectedFrom,to:selectedTo,today});context.directory=result[1];showDays();state('Review each date, describe the change, then confirm with your staff PIN.');
  }catch(error){if(token===epoch&&dialog.open)state(error.message||'The saved roster could not load.');}finally{if(token===epoch){busy=false;controls();}}
 }
 async function submit(event){event.preventDefault();if(busy||!context)return;const token=epoch;let value=pin.value;pin.value='';
  try{assert(token);if(!value.trim())throw Error('Enter your current staff PIN.');if(!pending){const id=freshId(),proposal=normalizeScheduleProposal({version:1,id,branch:context.branch,month:context.month,from:context.from,to:context.to,reason:reason.value,baseRevisionId:context.baseRevisionId,baseBranchFingerprint:context.baseBranchFingerprint,days:proposalDaysFromChoices(context,(date,id)=>selectors.get(date+'|'+id)?.value||'')},{monthView:view,staff:context.directory,today:scheduleDateKey(now())});pending={proposal,operationId:id};}
   busy=true;controls();state('Sending this proposal to HQ…');const confirmed=await transport.submit({staffId:permit.staffId,pin:value,uid:permit.uid,...pending,assertCurrent:()=>assert(token)});value='';assert(token);
   pending=null;context=null;send.disabled=true;daysNode.replaceChildren();state(confirmed.status==='Pending'?'Proposal received by HQ. The Owner can review it in HR Review Center → Schedule proposals. The saved roster stays in effect until approved.':`HQ already recorded this proposal as ${confirmed.status}. Refresh Branch Schedule to see its saved state.`);
  }catch(error){value='';if(token===epoch&&dialog.open){state((error.message||failure)+(pending?' Retry keeps the same proposal number and prevents a duplicate. Enter your PIN again.':''));}}
  finally{value='';if(token===epoch){busy=false;controls();}}
 }
 async function verifyDevice(request=false){if(busy||!preAuth)return;const token=epoch;busy=true;deviceReady=false;permit=null;pin.value='';controls();state('Confirming this tablet’s secure HQ approval…');
  try{const setupCurrent=()=>{preAuth?.assertCurrent();if(token!==epoch||!dialog.open)throw Error('This setup closed. Reopen Branch Schedule.');};
   if(deviceContext){if(typeof deviceContext.resolve!=='function')throw Error('Secure tablet setup is unavailable. Ask HQ to update the Cashier app.');const selected=await deviceContext.resolve({assertCurrent:setupCurrent});setupCurrent();if(!selected?.auth||!selected.deviceApi)throw Error('Secure tablet setup could not be confirmed. Check approval again.');selectedAuth=selected.auth;session=createScheduleProposalSession(w,selectedAuth);transport=createScheduleProposalTransport({auth:selectedAuth,fetcher,timeoutMs});gate=deviceGate||createScheduleProposalDeviceGate({api:selected.deviceApi,auth:selectedAuth,signInAnonymously,timeoutMs});}
   const result=await gate.check({permit:preAuth,request,assertCurrent:setupCurrent});preAuth.assertCurrent();if(token!==epoch||!dialog.open)return;
   if(result.status==='Active'){permit=session.capture();if(permit.uid!==result.uid)throw Error('The tablet account changed. Reopen Branch Schedule.');deviceReady=true;approval.hidden=true;state('Choose the dates to change, then load the saved roster.');}
   else{approval.hidden=false;requestApproval.hidden=result.status!=='Missing';approvalText.textContent=result.status==='Missing'?'This tablet needs the Owner’s secure approval before it can send schedule proposals. Request approval, then ask the Owner to open Device Fleet → Cashier device approvals.':'Approval requested. Ask the Owner to open Device Fleet → Cashier device approvals and approve this tablet. This does not change the branch roster.';approvalUid.textContent='Secure tablet ID: '+result.uid;state('Schedule proposals are locked until the Owner approves this secure tablet ID.');}
  }catch(error){if(token===epoch&&dialog.open){approval.hidden=false;requestApproval.hidden=true;approvalText.textContent=error.message||'This tablet could not be confirmed. Reconnect and check approval.';approvalUid.textContent='';state('No schedule proposal was sent. Check the saved approval or ask the Owner to review Device Fleet.');}}
  finally{if(token===epoch){busy=false;controls();}}
 }
 function open(){clear();try{preAuth=staffSession.captureStaff();const today=scheduleDateKey(now());from.min=to.min=today;from.value=to.value=today;reason.value='';find('[data-proposal-identity]').textContent=preAuth.name+' · '+preAuth.branch;approval.hidden=true;dialog.showModal();controls();timer=w.setInterval(()=>{try{(permit||preAuth)?.assertCurrent();}catch{close();}},1000);void verifyDevice();}catch(error){permit=null;preAuth=null;w.Swal?.fire?.('Branch schedule',error.message,'info');}}
 requestApproval.onclick=()=>void verifyDevice(true);checkApproval.onclick=()=>void verifyDevice(false);
 openButton.onclick=open;load.onclick=()=>void loadRoster();form.addEventListener('submit',submit);for(const button of dialog.querySelectorAll('[data-proposal-close]'))button.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(permit){clear();permit=null;}});
 const changed=()=>{if(context&&!pending){context=null;view=null;daysNode.replaceChildren();send.disabled=true;state('The dates changed. Load the saved roster again before editing.');}};from.addEventListener('change',changed);to.addEventListener('change',changed);
 w.addEventListener('pagehide',()=>{if(dialog.open)close();});w.addEventListener('pageshow',event=>{if(event.persisted&&dialog.open)close();});
 const controller={open,close,load:loadRoster};w.cashierScheduleProposals=controller;return controller;
}
