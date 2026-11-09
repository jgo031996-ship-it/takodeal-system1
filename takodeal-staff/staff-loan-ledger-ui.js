import {staffLoanLedgerHTML} from './staff-loan-ledger-model.js';
import {staffLoanLedgerError} from './staff-loan-ledger-client.js';
export function installStaffLoanLedger(window,document,{createClient}={}){
 if(window.staffLoanLedgerUI)return window.staffLoanLedgerUI;
 const get=id=>document.getElementById(id),identity=()=>window.localStorage.getItem('takodeal_staff_id'),device=()=>window.localStorage.getItem('takodeal_device_id');
 let epoch=0,active=null,client=null;
 const visible=()=>get('loansModal')?.style.display==='flex';
 const clear=()=>{epoch++;active=null;client?.invalidate();client=null;if(get('staffMyLoansContent'))get('staffMyLoansContent').replaceChildren();if(get('staffMyLoansStatus'))get('staffMyLoansStatus').textContent='';if(get('loansModal'))get('loansModal').style.display='none';};
 const current=token=>active===token&&epoch===token.epoch&&identity()===token.staffId&&device()===token.deviceId&&!document.hidden&&visible()&&client?.isCurrent?.()!==false&&window.staffVaultSession?.allows(token.staffId,token.vaultEpoch)===true;
 async function load(){
  if(!identity()||document.hidden)return;
  if(!window.staffVaultSession?.allows(identity()))return window.openVaultPin?.('unlock','loans');
  if(active&&current(active)&&active.busy)return;
  clear();const token={epoch,staffId:identity(),deviceId:device(),vaultEpoch:window.staffVaultSession.epoch,busy:true};active=token;
  get('loansModal').style.display='flex';get('staffMyLoansStatus').textContent='Checking your private loan records…';get('staffMyLoansStatus').setAttribute('aria-busy','true');get('staffMyLoansRefresh').disabled=true;
  const assertCurrent=()=>{if(!current(token))throw staffLoanLedgerError('loan-ledger-account-changed');};
  try{
   client=createClient({onInvalidate:clear});const result=await client.read({assertCurrent});assertCurrent();
   get('staffMyLoansContent').innerHTML=staffLoanLedgerHTML(result);
   get('staffMyLoansStatus').textContent=result.reviewRequired?'HQ review required':result.ledger?'Saved ledger checked':'No company loan ledger recorded';
  }catch(error){if(current(token)){get('staffMyLoansContent').replaceChildren();get('staffMyLoansStatus').textContent=error?.code?.startsWith('loan-ledger-')?error.message:staffLoanLedgerError('loan-ledger-unavailable').message;}}
  finally{if(current(token)){token.busy=false;get('staffMyLoansStatus').setAttribute('aria-busy','false');get('staffMyLoansRefresh').disabled=false;}}
 }
 window.loadMyLoanLedger=load;
 window.clearStaffLoanLedger=clear;
 window.closeMyLoanLedger=()=>{clear();window.lockPayslipVault?.();};
 get('staffMyLoansClose')?.addEventListener('click',window.closeMyLoanLedger);
 get('staffMyLoansRefresh')?.addEventListener('click',load);
 get('loansModal')?.addEventListener('keydown',event=>{if(event.key==='Escape')window.closeMyLoanLedger();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});window.addEventListener('pagehide',clear);
 for(const name of ['switchView','stopStaffLiveListeners','logoutStaff']){const prior=window[name];window[name]=function(...args){clear();return prior?.apply(this,args);};}
 window.addEventListener('storage',event=>{if(['takodeal_staff_id','takodeal_device_id'].includes(event.key))clear();});
 const check=()=>{if(active&&!current(active))clear();};
 const timer=window.setInterval?.(check,1000);timer?.unref?.();
 return window.staffLoanLedgerUI={load,clear,check};
}
