// Refresh on return to an unlocked Pay view; no permanent payroll listener or
// background polling is needed. Concurrent taps share the same real load.
export function installPayrollVaultFreshness(w,d,{now=()=>Date.now()}={}){
 if(w.payrollVaultFreshness)return w.payrollVaultFreshness;
 const load=w.loadPayslipVault;if(typeof load!=='function')throw Error('Pay is not ready.');
 let flight=null,key=null,lastAt=0;
 const identity=()=>{const staffId=w.localStorage.getItem('takodeal_staff_id');return staffId&&w.staffVaultSession?.allows(staffId)?staffId+'|'+w.staffVaultSession.epoch:null;};
 async function refresh(){const active=identity();if(!active)return; if(flight&&key===active)return flight;key=active;const request=Promise.resolve().then(()=>load.call(w));flight=request;try{await request;if(identity()===active){lastAt=now();mount();}}finally{if(flight===request)flight=null;}}
 function mount(){const section=d.getElementById('payslipLiveSection');if(!section||!identity()||d.getElementById('staffRefreshPay'))return;const button=d.createElement('button');button.id='staffRefreshPay';button.type='button';button.textContent='Refresh pay & adjustments';button.style.cssText='min-height:44px;padding:10px 14px;margin:0 0 14px;border:1px solid #cbded0;border-radius:9px;background:white;color:#145947;font-weight:600';button.onclick=async()=>{button.disabled=true;button.textContent='Refreshing pay…';try{await refresh();}finally{if(button.isConnected){button.disabled=false;button.textContent='Refresh pay & adjustments';}}};section.prepend(button);}
 w.loadPayslipVault=refresh;
 d.addEventListener('visibilitychange',()=>{if(!d.hidden&&identity()&&now()-lastAt>=30000&&!w.Swal?.isVisible?.())void refresh().catch(()=>{});});
 const controller={refresh,mount};w.payrollVaultFreshness=controller;return controller;
}
