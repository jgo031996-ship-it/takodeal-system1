// Local display and Owner preview recovery. Device access always needs its
// existing private UID binding and a fresh matching Active fleet registration.
export const OWNER_PREVIEW_KEY='takodeal_cashier_owner_preview_v1';
export function hasCashierOwnerPreview(w){try{return w.localStorage.getItem(OWNER_PREVIEW_KEY)!==null;}catch{return true;}}
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const branch=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=120;
const fresh=snapshot=>{if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Reconnect to confirm this tablet’s saved branch.');return snapshot;};
export function refreshCashierBranchLabel(w,d){
 let saved='';try{saved=w.localStorage.getItem('takodeal_device_branch')||'';}catch{}
 const label=d.getElementById('loginBranchDisplay');if(label)label.textContent=branch(saved)?'📍 '+saved:'Select a branch to set up';
 const display=d.getElementById('displayDeviceLocation');if(display&&branch(saved))display.textContent=saved;
 if(branch(saved))w.POS_BRANCH=saved;return saved;
}
export function cashierStartupBusy(w){
 if(w.sessionUser||w.cart?.length||Object.values(w.platformCarts||{}).some(items=>Array.isArray(items)&&items.length)||w.cashierCashCountActive||w.cashierRemitSubmitting||w.isProcessingOrder||w.isSubmittingOrder||w.cashierShiftOpening)return true;
 try{for(let i=0;i<w.localStorage.length;i++){const name=w.localStorage.key(i);if(typeof name==='string'&&(name.startsWith('takodeal_cash_remittance_v4:')||name.startsWith('takodeal_remittance_attempt_v1:')))return true;}}catch{return true;}
 return false;
}
function preview(w){const raw=w.localStorage.getItem(OWNER_PREVIEW_KEY);if(raw===null)return null;let saved;try{saved=JSON.parse(raw);}catch{throw Error('The saved Owner preview needs review. Keep the tablet data and open Owner Access.');}
 if(!saved||saved.version!==1||!key(saved.deviceId)||!branch(saved.originalBranch)||!branch(saved.previewBranch)||typeof saved.createdAt!=='string'||!Number.isFinite(Date.parse(saved.createdAt)))throw Error('The saved Owner preview needs review. Keep the tablet data and open Owner Access.');return saved;
}
export function beginCashierOwnerPreview(w,selectedBranch,{now=()=>new Date()}={}){
 if(cashierStartupBusy(w))throw Error('Finish or park the order and sign out of the cashier session before opening an Owner branch preview. Keep any pending cash handover on this tablet.');
 const storage=w.localStorage,current=storage.getItem('takodeal_device_branch'),deviceId=storage.getItem('takodeal_device_id');
 if(!branch(selectedBranch)||!branch(current)||!key(deviceId))throw Error('Complete this tablet’s branch registration before opening an Owner preview.');
 const prior=preview(w);if(prior&&(prior.deviceId!==deviceId||current!==prior.previewBranch))throw Error('The saved Owner preview does not match this tablet. Review Device Fleet.');
 const marker={version:1,deviceId,originalBranch:prior?.originalBranch||current,previewBranch:selectedBranch,createdAt:prior?.createdAt||now().toISOString()};
 const value=JSON.stringify(marker);storage.setItem(OWNER_PREVIEW_KEY,value);if(storage.getItem(OWNER_PREVIEW_KEY)!==value)throw Error('The preview could not be saved safely. The tablet branch was not changed.');
 storage.setItem('takodeal_device_branch',selectedBranch);w.ownerPreviewActive=true;w.POS_BRANCH=selectedBranch;return marker;
}
export function createCashierBranchRecovery(w,d,{deviceContext,timeoutMs=12000}={}){
 let pending=null,checked=null;
 const identity=()=>JSON.stringify([w.localStorage.getItem('takodeal_device_id'),w.localStorage.getItem('takodeal_device_branch')]);
 async function recover({force=false}={}){
  if(!force&&!hasCashierOwnerPreview(w))return {status:'NotNeeded'};
  if(cashierStartupBusy(w))return {status:'Busy'};
  const signature=identity();if(pending?.signature===signature)return pending.promise;if(checked===signature)return {status:'Checked'};
  const deviceId=w.localStorage.getItem('takodeal_device_id'),currentBranch=w.localStorage.getItem('takodeal_device_branch');if(!key(deviceId)||!branch(currentBranch))return {status:'Unconfigured'};
  let expired=false,timer;const guard=()=>{if(expired)throw Error('Tablet branch confirmation took too long. Check the saved device approval when connected.');if(identity()!==signature||cashierStartupBusy(w))throw Error('The cashier, order or tablet branch changed. Keep its saved data and check Device Fleet.');};
  const work=(async()=>{
   guard();const marker=preview(w);if(marker&&(marker.deviceId!==deviceId||marker.previewBranch!==currentBranch))throw Error('The saved Owner preview does not match this tablet. Review Device Fleet.');
   const context=await deviceContext.resolve({assertCurrent:guard});guard();const user=context.auth?.currentUser;if(!user?.uid||user.isAnonymous!==true)return {status:'NoDeviceIdentity'};
   const api=context.deviceApi,check=()=>{guard();if(context.auth.currentUser!==user)throw Error('The tablet identity changed. Check its saved approval again.');};
   const saved=fresh(await api.getDocFromServer(api.doc(api.db,'pos_bindings',user.uid)));check();if(!saved.exists())return {status:'Unlinked',uid:user.uid};const binding=saved.data();
   if(binding.uid!==user.uid||binding.deviceId!==deviceId||!branch(binding.branch)||!key(binding.legacyDeviceDocId)||binding.status!=='Active')return {status:'NeedsReview',uid:user.uid};
   const mirror=fresh(await api.getDocFromServer(api.doc(api.db,'pos_devices',binding.legacyDeviceDocId)));check();if(!mirror.exists())return {status:'NeedsReview',uid:user.uid};const fleet=mirror.data();
   if(fleet.status!=='Active'||fleet.deviceId!==deviceId||fleet.branch!==binding.branch||String(fleet.appType||'').trim().toLowerCase()==='staff'||marker&&marker.originalBranch!==binding.branch)return {status:'NeedsReview',uid:user.uid};
   check();if(currentBranch!==binding.branch){w.localStorage.setItem('takodeal_device_branch',binding.branch);if(w.localStorage.getItem('takodeal_device_branch')!==binding.branch)throw Error('The approved tablet branch could not be restored. Keep the app open and ask the Owner to review device storage.');}
   if(marker)w.localStorage.removeItem(OWNER_PREVIEW_KEY);w.ownerPreviewActive=false;refreshCashierBranchLabel(w,d);checked=identity();return {status:currentBranch!==binding.branch||marker?'Restored':'Confirmed',branch:binding.branch,uid:user.uid};
  })();
  const promise=Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Tablet branch confirmation took too long. Check the saved device approval when connected.'));},timeoutMs);})]).finally(()=>{expired=true;clearTimeout(timer);if(pending?.promise===promise)pending=null;});pending={signature,promise};return promise;
 }
 return {recover};
}
