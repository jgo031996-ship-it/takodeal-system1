import {normalizeStaffMessengerUrl} from './staff-messenger-link.js';
import {checkSavedPayrollPayment,PAYROLL_SETTLEMENT_LIMITS} from './payroll-settlement.js';
import {payrollActorKey} from './payroll-completion.js';

const selection=data=>({staffId:data?.staffId||data?.profile?.staffId||data?.profile?.id,name:data?.name,branch:data?.branch,start:data?.start,end:data?.end});
const selectionKey=data=>JSON.stringify(selection(data));
const paid=(api,data)=>data?.isPaid===true||!!data&&api.paidPayrollSnapshots?.has(data)===true;
const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const personName=row=>String(row?.cashierName||row?.fullName||row?.name||'').trim();
export function installPayrollMessenger(api,d,{presentSaved,timeoutMs=PAYROLL_SETTLEMENT_LIMITS.timeoutMs}={}){
 let dialog=null,flight=null,disposed=false;
 const notify=text=>api.ManagerUI?.notify?.(text);
 const button=d.getElementById('btnPreparePayrollMessenger');
 function capture(data){
  const actor=payrollActorKey(api),person=selection(data),key=JSON.stringify(person);
  if(!person.staffId||!person.name||!person.branch||!person.start||!person.end)throw Error('Open the saved employee’s paid payslip first.');
  const current=()=>{if(disposed||payrollActorKey(api)!==actor||selectionKey(api.currentPayslipData)!==key||api.isBranchAllowed?.(person.branch)===false)throw Error('The employee, cutoff or account changed. Reopen the correct paid payslip.');};
  current();return {actor,person,key,current};
 }
 async function staff(scope){
  scope.current();const snap=await api.getDocFromServer(api.doc(api.db,'cashiers',scope.person.staffId));scope.current();
  if(!snap||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||!snap.exists())throw Error('The saved employee contact could not be confirmed. Reconnect and try again.');
  const row=snap.data();if(personName(row)!==scope.person.name||row.branch!==scope.person.branch)throw Error('The saved employee identity changed. Reopen their current paid payslip.');
  return row;
 }
 function show(scope,result,profile){
  scope.current();const url=normalizeStaffMessengerUrl(profile.messengerUrl);if(!url)throw Error('Add this employee’s Messenger or Facebook profile link in Staff & Security first.');
  dialog?.close();dialog?.remove();const node=d.createElement('dialog');dialog=node;node.className='owner-time-out-correction payroll-messenger';node.setAttribute('aria-labelledby','payrollMessengerTitle');
  node.innerHTML='<header><div><small>PAID PAYSLIP · MESSENGER</small><h2 id="payrollMessengerTitle">Prepare payslip for Messenger</h2></div><button type="button" data-close aria-label="Close Messenger preparation">×</button></header><div class="owner-time-out-body"><p class="owner-time-out-note">Download the image, open the saved conversation, attach the image and tap Send yourself.</p><dl><div><dt>Employee</dt><dd data-person></dd></div><div><dt>Paid cutoff</dt><dd data-cutoff></dd></div><div><dt>Confirmed net pay</dt><dd data-net></dd></div></dl><label>Message to copy<textarea data-message rows="4" readonly></textarea></label><p data-status role="status" aria-live="polite">The paid record is confirmed. No message has been sent.</p></div><footer><button type="button" data-download data-prepare>Download payslip image</button><button type="button" data-copy>Copy message</button><a data-open target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Open saved Messenger / profile</a><button type="button" data-close>Close</button></footer>';
  const el=selector=>node.querySelector(selector),status=el('[data-status]'),message='Hello '+scope.person.name+', your payslip for '+scope.person.start+' to '+scope.person.end+' is ready. Net pay: '+money(result.finalNetPay)+'. Please review the attached payslip image.';
  el('[data-person]').textContent=scope.person.name+' · '+scope.person.branch;el('[data-cutoff]').textContent=scope.person.start+' to '+scope.person.end;el('[data-net]').textContent=money(result.finalNetPay);el('[data-message]').value=message;
  const current=()=>{scope.current();if(dialog!==node||!node.open||!paid(api,api.currentPayslipData)||Number(api.currentPayslipData.finalNetPay)!==Number(result.finalNetPay))throw Error('Reopen the confirmed paid payslip before preparing its message.');};
  node.querySelectorAll('[data-close]').forEach(close=>close.onclick=()=>node.close());node.addEventListener('close',()=>{if(dialog===node)dialog=null;node.remove();});
  const link=el('[data-open]');link.href=url;link.setAttribute('style','display:inline-flex;align-items:center;min-height:42px;padding:10px 14px;border:1px solid #cbdccf;border-radius:8px;color:#17624e;text-decoration:none;font-weight:700;font-size:12px;overflow-wrap:anywhere;');
  link.addEventListener('click',event=>{try{current();}catch(error){event.preventDefault();notify(error.message);}});
  el('[data-copy]').onclick=async()=>{try{current();if(typeof api.navigator?.clipboard?.writeText!=='function')throw Error('Select and copy the message shown above.');await api.navigator.clipboard.writeText(message);current();status.textContent='Message copied. Attach the payslip in Messenger and tap Send yourself.';}catch(error){notify(error.message);}};
  el('[data-download]').onclick=async()=>{const download=el('[data-download]');try{current();if(download.disabled)return;download.disabled=true;if(typeof api.downloadPayslipImage!=='function')throw Error('Reopen this saved payslip to download its image.');const exported=await api.downloadPayslipImage();current();if(!exported)throw Error('The image was not downloaded. The paid payroll remains saved; try Download payslip image again.');status.textContent='Image downloaded. Attach it in Messenger and tap Send yourself.';}catch(error){notify(error.message);}finally{if(node.open)download.disabled=false;}};
  d.body.append(node);node.showModal();return {prepared:true,staffId:scope.person.staffId,start:scope.person.start,end:scope.person.end};
 }
 function begin(data,{offer=false}={}){
  let scope;try{scope=capture(data);}catch(error){if(!offer)notify(error.message);return Promise.resolve(false);}
  if(flight)return flight.key===scope.actor+'|'+scope.key?flight.visible:Promise.resolve(false);
  const entry={key:scope.actor+'|'+scope.key,cancelled:false};flight=entry;const label=button?.innerText;if(button){button.disabled=true;button.innerText='Checking saved payslip…';}
  const current=()=>{scope.current();if(entry.cancelled)throw Error('Messenger preparation timed out. Reconnect and prepare this saved payslip again.');};
  const work=(async()=>{
   if(offer){const profile=await staff(scope);current();if(profile.messengerPayslipPrompt!==true)return false;}
   const result=await checkSavedPayrollPayment(api,{data,assertCurrent:current});current();if(result.status!=='paid')throw Error('No confirmed paid payroll was found for this employee and cutoff. Confirm its saved payment first.');
   const profile=await staff(scope);current();if(offer&&profile.messengerPayslipPrompt!==true)return false;
   if(!normalizeStaffMessengerUrl(profile.messengerUrl))throw Error('Add this employee’s Messenger or Facebook profile link in Staff & Security first.');
   if(typeof presentSaved!=='function')throw Error('Reopen the Owner app to prepare a saved payslip.');
   const presented=await presentSaved(result,{...scope.person,assertCurrent:current});current();
   if(selectionKey(presented)!==scope.key||!paid(api,presented)||Number(presented.finalNetPay)!==Number(result.finalNetPay))throw Error('The confirmed paid payslip could not be displayed. Reopen it before sharing.');
   return show(scope,result,profile);
  })();
  let timer;entry.visible=Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{entry.cancelled=true;reject(Error('Messenger preparation took too long. Reconnect and try again after the current check finishes.'));},timeoutMs);})]).catch(error=>{try{scope.current();notify(error.message);}catch{}return false;}).finally(()=>{clearTimeout(timer);try{scope.current();if(button){button.disabled=false;button.innerText=label;}}catch{}});
  void work.finally(()=>{if(flight===entry)flight=null;}).catch(()=>{});return entry.visible;
 }
 const prepare=(data=api.currentPayslipData)=>begin(data),offer=(data=api.currentPayslipData)=>paid(api,data)?begin(data,{offer:true}):Promise.resolve(false),clicked=()=>void prepare();
 button?.addEventListener('click',clicked);api.preparePayrollMessenger=prepare;api.offerPayrollMessenger=offer;
 return {prepare,offer,close:()=>dialog?.close(),dispose(){disposed=true;if(flight)flight.cancelled=true;dialog?.close();button?.removeEventListener?.('click',clicked);if(api.preparePayrollMessenger===prepare)delete api.preparePayrollMessenger;if(api.offerPayrollMessenger===offer)delete api.offerPayrollMessenger;}};
}
