import {crewRequest,operationFor,centsOf,pesos,html} from './crew-operations-client.js';
export function installCashierStash(w,d,resolve){
 const panel=d.getElementById('sales-coins-stash'),view=d.getElementById('view-sales');
 if(!panel||!view)return;
 const summary=panel.querySelector('[data-summary]'),buy=panel.querySelector('button');let generation=0,state=null,reading=false;
 const context=()=>JSON.stringify([w.sessionUser?.staffLoginSessionId,w.sessionUser?.branch,w.currentShift?.shiftId]);
 const visible=()=>!d.hidden&&view.getClientRects().length>0;
 async function call(action,data,identity){
  const guard=()=>{if(identity!==context())throw Error('The staff or branch changed. Reopen Sales History.');};
  const api=await resolve({assertCurrent:guard}),actor=api.staffPinActor();guard();
  return crewRequest(api.auth.currentUser,'stash/'+action,{deviceId:actor.deviceId,sessionId:actor.sessionId,shiftId:w.currentShift?.shiftId,branch:w.sessionUser?.branch,...data},()=>{guard();api.assertStaffOperationalCurrent();});
 }
 async function refresh(){
  if(!visible()||reading)return;const id=++generation,identity=context();reading=true;state=null;buy.hidden=true;summary.textContent='Checking Coins Stash…';
  try{const next=await call('read',{},identity);if(id!==generation||identity!==context())return;state={...next,identity};summary.textContent=next.configured?next.name+' · '+pesos(next.balance)+(next.note?' · '+next.note:''):'Coins Stash has no linked account at this branch.';buy.hidden=!next.configured;}
  catch(e){if(id===generation)summary.textContent=e.message;}finally{reading=false;}
 }
 buy.onclick=async()=>{const saved=state;if(!saved?.configured||saved.identity!==context())return refresh();buy.disabled=true;
  try{
   const history=(saved.history||[]).slice(0,5).map(r=>'<li>'+html(r.action==='spend'?'Purchase':'Addition')+' · '+html(pesos(r.amount))+' · '+html(r.note)+'</li>').join('');
   const result=await w.Swal.fire({title:'Coins Stash · '+saved.branch,html:'<p>Available '+html(pesos(saved.balance))+'</p><label>Purchase amount (₱)<input id="stash-spend" class="swal2-input" type="number" min="0.01" step="0.01"></label><label>What did you buy?<input id="stash-reason" class="swal2-input" maxlength="240"></label>'+(history?'<details><summary>Recent entries</summary><ul>'+history+'</ul></details>':''),showCancelButton:true,confirmButtonText:'Log deduction',preConfirm:()=>{try{const note=d.getElementById('stash-reason').value.trim();if(!note)throw Error('Enter what you bought for the store.');return {accountId:saved.accountId,cents:centsOf(d.getElementById('stash-spend').value),note};}catch(e){w.Swal.showValidationMessage(e.message);return false;}}});
   if(!result.isConfirmed)return;const body=result.value,op=operationFor(w.sessionStorage,saved.identity+'|spend',body);
   await call('spend',{...body,operationId:op.id},saved.identity);op.done();await refresh();
  }catch(e){await w.Swal.fire('Coins Stash',e.message,'warning');}finally{buy.disabled=false;}
 };
 panel.querySelector('[data-refresh]').onclick=refresh;
 new MutationObserver(()=>{if(visible())void refresh();else{generation++;state=null;buy.hidden=true;summary.textContent='';}}).observe(view,{attributes:true,attributeFilter:['class','style','hidden']});
 w.addEventListener('online',refresh);d.addEventListener('visibilitychange',refresh);w.setInterval(refresh,30000);void refresh();
}
