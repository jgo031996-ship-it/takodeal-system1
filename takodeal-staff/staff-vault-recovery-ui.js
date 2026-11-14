// Recovery always leaves the Pay and rate screens locked. Only the normal PIN
// unlock flow may reveal them after the server confirms a new PIN.
export function installStaffVaultRecovery(w=window,d=document,{createClient=()=>w.staffVaultRecoveryClient}={}){
 if(w.staffVaultRecovery)return w.staffVaultRecovery;
 let epoch=0,client=null,dialog=null,busy=false,opening=false;
 const el=id=>d.getElementById(id),identity=()=>JSON.stringify([w.localStorage.getItem('takodeal_staff_id'),w.localStorage.getItem('takodeal_staff_name'),w.localStorage.getItem('takodeal_device_id')]);
 const wipe=()=>{for(const id of ['vaultRecoveryCode','vaultRecoveryNewPin','vaultRecoveryConfirmPin'])if(el(id))el(id).value='';};
 function close(){epoch++;client?.invalidate?.();busy=false;wipe();if(dialog?.open)dialog.close();}
 function mount(){
  if(dialog)return dialog;
  dialog=d.createElement('dialog');dialog.id='staffVaultRecoveryDialog';dialog.className='vault-pin-card';dialog.setAttribute('aria-labelledby','vaultRecoveryTitle');dialog.style.cssText='width:min(430px,calc(100% - 32px));max-height:90dvh;overflow:auto;border:0;border-radius:18px;padding:24px;color:#163c35;background:#fff';
  dialog.innerHTML='<h2 id="vaultRecoveryTitle">Create a new Payslip PIN</h2><p id="vaultRecoveryStatus" role="status" aria-live="polite">Checking your personally approved phone…</p><form id="vaultRecoveryForm" hidden><p>Your personal setup code is separate from your daily Staff login PIN. Ask HQ for it if needed.</p><label class="field-label" for="vaultRecoveryCode">Personal setup code from HQ · 10 digits</label><input type="password" id="vaultRecoveryCode" inputmode="numeric" maxlength="14" autocomplete="off" required><label class="field-label" for="vaultRecoveryNewPin">New Payslip PIN · 6–8 digits</label><input type="password" id="vaultRecoveryNewPin" inputmode="numeric" minlength="6" maxlength="8" autocomplete="new-password" required><label class="field-label" for="vaultRecoveryConfirmPin">Confirm new PIN</label><input type="password" id="vaultRecoveryConfirmPin" inputmode="numeric" minlength="6" maxlength="8" autocomplete="new-password" required><button type="submit" id="vaultRecoverySave" class="btn-primary">Save new Payslip PIN</button></form><p id="vaultRecoveryError" class="form-error" role="alert" hidden></p><button type="button" id="vaultRecoveryClose" class="btn-outline">Close</button>';
  d.body.append(dialog);el('vaultRecoveryClose').onclick=close;dialog.addEventListener('close',()=>{epoch++;client?.invalidate?.();busy=false;wipe();});dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});el('vaultRecoveryForm').addEventListener('submit',submit);return dialog;
 }
 async function open(){
  if(opening||busy)return;
  opening=true;
  w.lockPayslipVault?.();const box=mount(),token=++epoch,owner=identity();busy=false;wipe();el('vaultRecoveryForm').hidden=true;el('vaultRecoveryError').hidden=true;el('vaultRecoveryStatus').textContent='Checking your personally approved phone…';el('vaultRecoveryTitle').textContent='Create a new Payslip PIN';el('vaultRecoveryClose').disabled=false;el('vaultRecoveryClose').textContent='Close';if(!box.open)box.showModal();
  const current=()=>{if(token!==epoch||!box.open||d.hidden||identity()!==owner)throw Error('Your staff account or recovery screen changed. Reopen PIN recovery.');};
  try{client=await createClient({assertCurrent:current});current();if(!client?.status||!client?.reset)throw Error('Personal PIN recovery is not ready. Ask HQ to confirm your phone setup, then update this app.');await client.status({assertCurrent:current});current();el('vaultRecoveryStatus').textContent='Phone confirmed. Enter your personal setup code and choose a new Payslip PIN. Your Vault stays locked.';el('vaultRecoveryForm').hidden=false;el('vaultRecoverySave').disabled=false;el('vaultRecoveryCode').focus?.();}
  catch(error){if(token===epoch&&box.open&&identity()===owner&&!d.hidden){el('vaultRecoveryStatus').textContent='This phone could not be confirmed.';el('vaultRecoveryError').textContent=error.message||'Ask HQ to confirm your personal phone setup.';el('vaultRecoveryError').hidden=false;}}
  finally{opening=false;}
 }
 async function submit(event){
  event?.preventDefault();if(busy||!dialog?.open||el('vaultRecoveryForm').hidden)return;const token=epoch,owner=identity(),current=()=>{if(token!==epoch||!dialog.open||d.hidden||identity()!==owner)throw Error('Your staff account or recovery screen changed. Reopen PIN recovery.');};
  busy=true;el('vaultRecoverySave').disabled=true;el('vaultRecoveryClose').disabled=true;el('vaultRecoveryError').hidden=true;el('vaultRecoveryStatus').textContent='Saving your new PIN. Keep this screen open until HQ confirms it.';
  const input={code:el('vaultRecoveryCode').value,newPin:el('vaultRecoveryNewPin').value,confirmPin:el('vaultRecoveryConfirmPin').value,assertCurrent:current};wipe();
  try{await client.reset(input);current();client.invalidate?.();el('vaultRecoveryForm').hidden=true;el('vaultRecoveryTitle').textContent='New Payslip PIN saved';el('vaultRecoveryStatus').textContent='Your new PIN is saved. The Vault is still locked. Enter your new PIN in the normal unlock screen when you are ready.';el('vaultRecoveryClose').textContent='Done';}
  catch(error){if(token===epoch&&dialog.open&&identity()===owner&&!d.hidden){el('vaultRecoveryStatus').textContent='The PIN save was not confirmed. Check the message below before retrying.';el('vaultRecoveryError').textContent=error.message||'It may have saved. Retry the same request after reconnecting.';el('vaultRecoveryError').hidden=false;}}
  finally{if(token===epoch&&dialog.open&&identity()===owner&&!d.hidden){busy=false;el('vaultRecoverySave').disabled=false;el('vaultRecoveryClose').disabled=false;}}
 }
 d.addEventListener('visibilitychange',()=>{if(d.hidden)close();});w.addEventListener('pagehide',close);
 w.openVaultRecovery=open;w.closeVaultRecovery=close;return w.staffVaultRecovery={open,close,submit};
}
