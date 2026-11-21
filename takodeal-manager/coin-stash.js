import {crewRequest,operationFor,centsOf,pesos,html} from './crew-operations-client.js';
export function addBranchStashControl(w,container,branch,accounts){
 const user=w.auth?.currentUser;if(!user||!w.sessionUser?.isOwner)return;
 const guard=()=>{if(w.auth.currentUser!==user||!w.sessionUser?.isOwner||!container.contains(button))throw Error('Reopen the branch ledger.');};
 const button=document.createElement('button');button.type='button';button.className='btn-secondary';button.textContent='Coins Stash';container.append(button);
 button.onclick=async()=>{
  button.disabled=true;
  try{
   const state=await crewRequest(user,'stash/read',{branch},guard);
   const opts=accounts.map(a=>'<option value="'+html(a.id)+'" '+(a.id===state.accountId?'selected':'')+'>'+html(a.name)+'</option>').join('');
   const result=await w.Swal.fire({title:'Coins Stash · '+branch,html:'<p>'+html(state.configured?state.name+' · '+pesos(state.balance):'Choose the cash account this branch uses for coins.')+'</p><label>Branch account<select id="stash-account" class="swal2-select"><option value="">Choose account</option>'+opts+'</select></label><label>Cashier note<textarea id="stash-note" class="swal2-textarea" maxlength="240">'+html(state.note)+'</textarea></label>',confirmButtonText:'Save account & note',showCancelButton:true,showDenyButton:state.configured===true,denyButtonText:'Add funds',preConfirm:()=>{const accountId=document.querySelector('#stash-account').value;if(!accountId){w.Swal.showValidationMessage('Choose a branch account.');return false;}return {accountId,note:document.querySelector('#stash-note').value.trim(),revision:state.revision||0};}});
   if(!result.isConfirmed&&!result.isDenied)return;let details=result.value,action='configure';
   if(result.isDenied){action='fund';const funding=await w.Swal.fire({title:'Add to '+state.name,html:'<label>Amount (₱)<input id="stash-amount" class="swal2-input" type="number" min="0.01" step="0.01"></label><label>Funding note<input id="stash-funding-note" class="swal2-input" maxlength="240"></label>',showCancelButton:true,confirmButtonText:'Record addition',preConfirm:()=>{try{const note=document.querySelector('#stash-funding-note').value.trim();if(!note)throw Error('Enter a funding note.');return {accountId:state.accountId,cents:centsOf(document.querySelector('#stash-amount').value),note};}catch(e){w.Swal.showValidationMessage(e.message);return false;}}});if(!funding.isConfirmed)return;details=funding.value;}
   guard();const body={branch,...details},op=operationFor(w.sessionStorage,[user.uid,branch,action].join('|'),body);
   await crewRequest(user,'stash/'+action,{...body,operationId:op.id},guard);op.done();
   await w.loadAccountsAndBudget?.();w.openBranchAccountsModal(branch);
  }catch(e){await w.Swal.fire('Coins Stash',e.message,'warning');}finally{button.disabled=false;}
 };
}
