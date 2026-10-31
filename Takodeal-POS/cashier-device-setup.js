import {createScheduleProposalDeviceGate} from './cashier-schedule-proposals.js';
const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);

// One tablet enrollment, shared by remittance, stock counts and schedules.
// Preparation only writes Pending. Only the Owner can activate this exact UID.
export function createCashierDeviceSetup(w,{deviceContext,signInAnonymously,beforePrepare=async()=>{},repairBranchMismatch,onStatus=()=>{}}={}){
 let pending=null,last=null,preparedAuth=null;
 const physical=()=>{
  const branch=w.localStorage.getItem('takodeal_device_branch'),deviceId=w.localStorage.getItem('takodeal_device_id');
  if(typeof branch!=='string'||!branch.trim()||branch.length>120||!validKey(deviceId))throw Error('Complete this Cashier tablet’s branch setup first.');
  return {branch,deviceId,signature:JSON.stringify([branch,deviceId])};
 };
 async function prepare(repaired=false){
  try{await beforePrepare();}catch(error){let tablet={};try{tablet=physical();}catch{}last={status:'Unavailable',branch:tablet.branch,deviceId:tablet.deviceId,message:error.message};onStatus(last);throw error;}
  const tablet=physical();
  if(pending?.signature===tablet.signature)return pending.promise;
  const assertCurrent=()=>{if(physical().signature!==tablet.signature)throw Error('The branch or tablet changed. Check the saved device approval again.');};
  const promise=(async()=>{
   const selected=await deviceContext.resolve({assertCurrent});assertCurrent();
   if(!selected?.auth||!selected.deviceApi)throw Error('Cashier tablet setup is still loading. Check the saved approval again.');
   const gate=createScheduleProposalDeviceGate({api:selected.deviceApi,auth:selected.auth,signInAnonymously});
   const result=await gate.check({permit:{branch:tablet.branch,deviceId:tablet.deviceId,assertCurrent},request:true,stagePendingFleet:true,assertCurrent});assertCurrent();
   preparedAuth=selected.auth;last={...result,branch:tablet.branch,deviceId:tablet.deviceId};onStatus(last);return last;
  })().catch(async error=>{if(!repaired&&error.code==='device-branch-mismatch'&&typeof repairBranchMismatch==='function'){try{const repairedBranch=await repairBranchMismatch();if(repairedBranch?.status==='Restored')return prepare(true);}catch(repairError){error=repairError;}}try{assertCurrent();last={status:'Unavailable',branch:tablet.branch,deviceId:tablet.deviceId,message:error.message,...(validKey(error.deviceUid)?{uid:error.deviceUid}:{})};onStatus(last);}catch{}throw error;}).finally(()=>{if(pending?.promise===promise)pending=null;});
  pending={signature:tablet.signature,promise};return promise;
 }
 async function ensurePrepared(){
  const tablet=physical();if(pending?.signature===tablet.signature)return pending.promise;
  // This memoizes enrollment preparation only, never authorization. Every
  // protected feature still confirms the current binding and fleet with HQ.
  const user=preparedAuth?.currentUser;
  if(last&&['Pending','Active'].includes(last.status)&&last.branch===tablet.branch&&last.deviceId===tablet.deviceId&&user?.isAnonymous===true&&user.uid===last.uid)return last;
  return prepare();
 }
 return {prepare,ensurePrepared,get status(){return last;}};
}

export function installCashierDeviceSetup(w,d,options){
 if(w.cashierDeviceSetup)return w.cashierDeviceSetup;
 let panel,summary,message,uid,retry;
 const paint=result=>{
  if(!panel)return;
  panel.hidden=result.status==='Active';
  summary.textContent=result.status==='Pending'?'Waiting for Owner device approval':'Tablet setup needs review';
  message.textContent=result.status==='Pending'?'One matched approval in Owner → Device Fleet covers the Cashier features.':result.message||'Check this tablet’s saved approval when connected.';
  uid.textContent=['Device ID: '+(result.deviceId||w.localStorage.getItem('takodeal_device_id')||'Not set'),'Branch: '+(result.branch||w.localStorage.getItem('takodeal_device_branch')||'Not set'),...(result.uid?['Approval UID: '+result.uid]:[])].join(' · ');
  retry.hidden=result.status==='Active';
 };
 const setup=createCashierDeviceSetup(w,{...options,onStatus:paint});
 function attach(){
  if(panel)return;
  const parent=d.getElementById('loginBranchDisplay')?.parentElement;if(!parent)return;
  panel=d.createElement('details');panel.className='cashier-device-status';panel.hidden=true;panel.setAttribute('aria-label','Cashier tablet approval');summary=d.createElement('summary');summary.textContent='Tablet setup';panel.append(summary);
  message=d.createElement('p');message.setAttribute('role','status');message.style.margin='0 0 6px';
  uid=d.createElement('small');uid.style.display='block';
  retry=d.createElement('button');retry.type='button';retry.textContent='Check saved device approval';retry.style.cssText='margin-top:8px;padding:8px 10px;border:1px solid #e5cbb1;border-radius:8px;background:white;color:#65422b;cursor:pointer';
  retry.onclick=()=>{retry.disabled=true;setup.prepare().catch(()=>{}).finally(()=>{retry.disabled=false;});};panel.append(message,uid,retry);(d.getElementById('cashierLoginCard')||parent).append(panel);if(setup.status)paint(setup.status);
 }
 const boot=()=>{attach();if(w.localStorage.getItem('takodeal_device_branch')&&w.localStorage.getItem('takodeal_device_id'))setup.prepare().catch(()=>{});};
 w.cashierDeviceSetup=setup;w.prepareCashierDeviceApproval=()=>setup.ensurePrepared();
 if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
 return setup;
}
