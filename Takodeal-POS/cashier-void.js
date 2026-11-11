import {legacyVoidUnitReview,legacyVoidUnitMarkup,validLegacyVoidReason} from './cashier-void-review.js';
import {checkoutPlatform,resetCheckoutForNextOrder} from './checkout-controls.js';
import {createVoidJournal,editableVoidCart,validateVoidView,voidCanonical,voidClone,voidHash,voidId,voidPayloadHash,voidTokenHash,voidSourcePlatform} from './cashier-void-model.js';

export const CASHIER_VOID_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/cashier-void/';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const held=()=>Error('This receipt still has a saved correction to check. Keep this tablet’s app data and use Check receipt correction.');
const changed=()=>Error('The cashier, branch, shift or order changed. Reopen the saved correction before continuing.');
const replacementIdentity=row=>row.replacement&&({saleId:row.replacement.saleId,receiptId:row.replacement.receiptId,claimToken:row.replacement.claimToken});

export function placeCashierVoidRecovery(d){
 const sales=d.getElementById?.('view-sales'),table=sales?.querySelector?.('.table-responsive'),card=table?.parentElement;
 if(!card||!d.createElement)return null;
 let box=d.getElementById('cashierVoidRecovery');
 if(!box){box=d.createElement('div');box.id='cashierVoidRecovery';box.className='cashier-void-recovery';}
 // The view is a horizontal flex row. Keep recovery inside its existing
 // vertical sales card, so it cannot become a column beside the table.
 if(box.parentElement!==card||box.nextElementSibling!==table)card.insertBefore(box,table);
 return box;
}

export function revealEditableVoidCart(w,d){
 w.switchView?.('pos');
 // Switching views shows POS; the existing responsive Cart control separately
 // reveals its editable panel on phones/tablets. Never load or replace an order.
 d.getElementById?.('tkCartToggle')?.click();
}

function voidPlatformSelector(d,platform){
 if(!['Standard','Grab','Foodpanda'].includes(platform))throw Error('The saved receipt channel could not be confirmed. Keep its original reference.');
 const selector=d.getElementById?.('posPlatformSelect');
 // Normal user changes select the option before the existing onchange handler.
 // A correction switches programmatically, so validate and sync that control.
 if(selector&&!Array.from(selector.options||[]).some(option=>option.value===platform))throw Error('The saved receipt channel is not configured in POS. Keep this correction reference.');
 return selector;
}
export function restoreVoidPlatform(w,d,platform,{switchCart=true}={}){
 const selector=voidPlatformSelector(d,platform);
 if(switchCart&&typeof w.switchPosPlatform==='function')w.switchPosPlatform(platform);
 else if(checkoutPlatform(w,d)!==platform)throw Error('The saved receipt channel controls are not ready. Keep the original correction reference.');
 if(selector)selector.value=platform;
 if(checkoutPlatform(w,d)!==platform||selector&&selector.value!==platform)throw changed();
}

export function voidPreviewMarkup(view){
 const amount=typeof view.source?.netTotal==='number'&&Number.isFinite(view.source.netTotal)?'₱'+view.source.netTotal.toFixed(2):'Saved amount unavailable';
 const movements=Array.isArray(view.effects)?view.effects:[];
 return '<p class="cashier-void-source"><strong>'+esc(view.sourceReceiptId)+'</strong><span>'+esc(view.branch)+' · '+esc(amount)+'</span></p>'+
  '<p>'+ (view.reason==='WrongPunched'?'The original receipt will be voided. Its items return to an editable order for a new checkout.':'The original receipt will be voided.')+'</p>'+
  '<p>Only saved deductions that were already applied return to Live Stocks. No bank payment is refunded automatically. Confirm that these ingredients were unused or physically returned; ask the Owner to record waste separately.</p>'+
  (movements.length?'<div class="cashier-void-movements">'+movements.map(row=>'<article><strong>'+esc(row.name)+'</strong><span><small>Before</small><b>'+esc(row.beforeStock)+' '+esc(row.unit)+'</b></span><span><small>After</small><b>'+esc(row.afterStock)+' '+esc(row.unit)+'</b></span></article>').join('')+'</div>':'<p class="cashier-void-note">No applied stock deduction will be added back.</p>')+
  (voidSourcePlatform(view)!=='Standard'?'<p class="cashier-void-note">This changes the local '+esc(voidSourcePlatform(view))+' ledger only. Check the provider’s order and payment records separately; no merchant cancellation or refund is sent.</p>':'')+
  (view.reason==='WrongPunched'?'<p class="cashier-void-note">Review the restored items, prices and options. Enter a new customer and payment through normal checkout. Previous payment and discount approvals are cleared.</p>':'');
}

export function installCashierVoid(w=window,d=document,{access=w.cashierVoidAccess,fetcher=w.fetch?.bind(w)||globalThis.fetch,timeoutMs=25000,makeId=()=> 'void-'+w.crypto.randomUUID(),makeAttempt=()=>w.crypto.randomUUID(),now=Date.now}={}){
 if(w.cashierVoid)return w.cashierVoid;
 if(typeof access?.capture!=='function')throw Error('Receipt correction is still loading. Reopen Shift Sales.');
 const journal=createVoidJournal(w.localStorage),physical=new Map(),cartOwners=new WeakMap(),writers=new Map();let flight=null,active=null,generation=0;
 const tabKey=op=>'takodeal_void_draft_tab_v1:'+op;
 function draftToken(row,create=false){const key=tabKey(row.operationId);let token=w.sessionStorage?.getItem(key);if(!token&&create){token=makeAttempt();w.sessionStorage?.setItem(key,token);if(w.sessionStorage?.getItem(key)!==token)throw Error('This tab cannot retain the correction recovery reference. No editable order was restored.');}if(!token||row.restoreAttemptId&&row.restoreAttemptId!==token)throw Error('This replacement belongs to its original tab. Reopen that tab or ask the Owner to review its saved correction.');return token;}
 const dialog=options=>w.Swal.fire({customClass:{popup:'cashier-void-modal'},confirmButtonColor:'#c65c24',cancelButtonColor:'#64748b',allowOutsideClick:false,...options});
 const session=()=>({person:w.sessionUser,uid:w.auth?.currentUser,staffId:w.sessionUser?.staffId||w.sessionUser?.id,name:w.sessionUser?.cashierName,branch:w.localStorage.getItem('takodeal_device_branch'),deviceId:w.localStorage.getItem('takodeal_device_id'),shift:w.currentShift,shiftId:w.currentShift?.shiftId});
 function capture({cart=true,requireOpen=true}={}){
  const start=session(),epoch=generation,order=w.cart,serialized=voidCanonical(order),platform=checkoutPlatform(w,d),platforms=voidCanonical(w.platformCarts||null),platformCache=w.platformCarts,platformRefs=Object.entries(w.platformCarts||{});let checkCart=cart;
  const guard=()=>{const current=session();if(epoch!==generation||current.person!==start.person||current.uid!==start.uid||current.staffId!==start.staffId||current.name!==start.name||current.branch!==start.branch||current.deviceId!==start.deviceId||current.shift!==start.shift||current.shiftId!==start.shiftId||requireOpen&&(!current.shift?.active||!voidId(start.shiftId))||w.sessionUser?.branch!==start.branch||!voidId(start.staffId)||checkCart&&(w.cart!==order||voidCanonical(w.cart)!==serialized||checkoutPlatform(w,d)!==platform||voidCanonical(w.platformCarts||null)!==platforms||w.platformCarts!==platformCache||platformRefs.some(([key,value])=>w.platformCarts?.[key]!==value)))throw changed();};
  guard.releaseCart=()=>{checkCart=false;};
  guard();return {start,guard};
 }
 const platformKey=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,'');
 function platformOrderType(platform){if(platform==='Standard')return null;const values=Array.from(d.getElementById('mainOrderType')?.options||[]).map(option=>option.value),key=platform==='Grab'?'grab':'foodpanda',value=values.find(value=>platformKey(value)===key||key==='foodpanda'&&platformKey(value)==='panda');if(!value)throw Error('The saved '+platform+' channel is not configured in POS. Keep this correction reference and ask the Owner to review its order types.');return value;}
 function emptyForReplacement(platform,ownedTarget=null){
  if(!['Standard','Grab','Foodpanda'].includes(checkoutPlatform(w,d))||!Array.isArray(w.cart)||w.cart.length||w.isActiveOrderMobile||w.parkedRecovery?.activeId?.())throw Error('Keep the current order safe: return to POS and park it first, then reopen this receipt with an empty Store POS cart.');
  if(platform){voidPlatformSelector(d,platform);if(platform!==checkoutPlatform(w,d)&&typeof w.switchPosPlatform!=='function')throw Error('The saved receipt channel controls are not ready. Keep the original correction reference.');platformOrderType(platform);const target=w.platformCarts?.[platform];if(platform!==checkoutPlatform(w,d)&&target!==undefined&&target!==ownedTarget&&(!Array.isArray(target)||target.length))throw Error('The '+platform+' cart already contains another order. Finish or park it first. Every saved correction and the current cart are kept.');}
 }
 function ready(){if(!voidId(w.sessionUser?.staffId||w.sessionUser?.id))throw Error('This sign-in is not confirmed for receipt changes. Ask the Owner to review this tablet’s existing setup. Normal Cashier work is unchanged.');if(w.navigator?.onLine===false)throw Error('Connect this tablet before changing a saved receipt. Pending sales and the current cart stay on this device.');if(w.isProcessingOrder||w.isSubmittingOrder||w.cashierRemitSubmitting||w.cashierCashCountActive)throw Error('Finish the current payment or cash count before correcting a receipt.');}
 function save(row){return journal.put(row);}
 function markCompletedCart(row){const owner=cartOwners.get(w.cart);if(owner?.operationId===row.operationId){owner.queued=true;active=null;}}
 function readCurrent(row){const saved=journal.get(JSON.parse(row.scope).uid,row.operationId);if(!saved||saved.scope!==row.scope||saved.reason!==row.reason||saved.saleId!==row.saleId)throw held();return saved;}
 function actorMatches(row,actor,metadataRecovery=false){const original=JSON.parse(row.scope);return ['uid','staffId','deviceId','branch'].every(key=>original[key]===actor[key])&&(actor.staffSessionId===(row.recoverySessionId||original.staffSessionId)||metadataRecovery&&['saved','claimed','queued'].includes(row.state)&&!!row.replacement);}
 async function connection(row,guard,{metadataRecovery=false}={}){
  guard();const context=access.capture({metadataRecovery}),api=await context.resolve();
  guard();const actor=context.actor();
  if(row&&!actorMatches(row,actor,metadataRecovery))throw held();
  return {actor,api,confirmReceiptPin:scope=>context.confirmReceiptPin(scope),needsRecoveryPin:()=>context.needsRecoveryPin?.()===true,current(){guard();context.current();if(row)readCurrent(row);}};
 }
 async function refreshRecoveryPin(row,connected){
  const expiry=Date.parse(row.recoveryPinExpiresAt||row.pinExpiresAt||''),recoveryExpiry=Date.parse(row.recoveryPinExpiresAt||'');if(row.recoveryPinVerificationId&&recoveryExpiry>now())return row;if(!connected.needsRecoveryPin()&&(!['saved','claimed','queued'].includes(row.state)||!row.pinVerificationId||!Number.isFinite(expiry)||expiry>now()))return row;
  const scope=await voidPayloadHash({operationId:row.operationId,saleId:row.saleId,receiptId:row.receiptId,branch:row.branch,shiftId:row.shiftId,reason:row.reason},w.crypto);connected.current();const proof=await connected.confirmReceiptPin(scope);connected.current();return save({...readCurrent(row),recoveryPinVerificationId:proof.verificationId,recoveryPinExpiresAt:proof.expiresAt});
 }
 async function rememberRecoveryAuthority(row,view,actor,assertCurrent){
  assertCurrent();
  const before=readCurrent(row),knownSaved=before.state==='saved'&&!before.payload&&!!before.replacement;
  const exactClaim=!!before.payload&&['claimed','queued'].includes(before.state)&&['claimed','committed'].includes(view.replacement?.state)&&view.replacement.checkoutAttemptId===before.checkoutAttemptId&&view.replacement.payloadHash===before.payloadHash&&await voidPayloadHash(before.payload,w.crypto)===before.payloadHash;
  assertCurrent();row=recordResult(before,view);
  if(!actorMatches(before,actor)){
   if(view.state!=='saved'||!(knownSaved||exactClaim)||!actorMatches(before,actor,true))throw Error('The original saved checkout claim could not be proved. Keep its frozen payment reference for the Owner; no new receipt will be created.');
   const history=[...(before.recoverySessionHistory||[]),before.recoverySessionId||JSON.parse(before.scope).staffSessionId];if(history.length>10)throw held();
   row=save({...row,recoverySessionId:actor.staffSessionId,recoverySessionHistory:history});
  }
  return row;
 }
 async function rpc(route,row,connection,extra={}){
  const slot=route+'|'+row.operationId;if(physical.has(slot))throw Error('The earlier receipt request is still finishing. Keep the same recovery reference.');
  const controller=new AbortController();let timer;const actor=connection.actor;
  const body={deviceId:actor.deviceId,staffId:actor.staffId,sessionId:actor.staffSessionId,branch:row.branch,shiftId:row.shiftId,saleId:row.saleId,receiptId:row.receiptId,reason:row.reason,operationId:row.operationId,...((['preview','commit'].includes(route)?row.pinVerificationId:row.recoveryPinVerificationId||row.pinVerificationId)?{pinVerificationId:['preview','commit'].includes(route)?row.pinVerificationId:row.recoveryPinVerificationId||row.pinVerificationId}:{}),...(route==='replacement-claim'?{claimToken:row.replacement?.claimToken}:{}),...extra};
  const work=(async()=>{connection.current();const token=await connection.api.auth.currentUser.getIdToken();connection.current();if(controller.signal.aborted)throw held();const response=await fetcher(CASHIER_VOID_ENDPOINT+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});connection.current();if(response.redirected||response.type==='opaque'||response.url&&response.url!==CASHIER_VOID_ENDPOINT+route)throw held();const raw=await response.text();connection.current();if(raw.length>1_000_000)throw held();let result;try{result=JSON.parse(raw);}catch{throw held();}if(!response.ok)throw Object.assign(Error(typeof result?.message==='string'?result.message.slice(0,1000):'The receipt result is not confirmed. Check the same saved correction.'),{code:result?.code,status:response.status,...(route==='preview'&&result?.code==='cashier-void/legacy-unit-review-required'?{unitReview:result.unitReview}:{})});return validateVoidView(result,row);})();
  physical.set(slot,work);work.finally(()=>{if(physical.get(slot)===work)physical.delete(slot);}).catch(()=>{});
  try{return await Promise.race([work,new Promise((_,reject)=>timer=setTimeout(()=>{controller.abort();reject(Error('The result is not confirmed yet. Keep this tablet’s app data and use Check receipt correction; do not start another void.'));},timeoutMs))]);}finally{clearTimeout(timer);}
 }
 function recordResult(row,view){
  row=readCurrent(row);
  if(view.state==='unknown')return row;
  if(view.state==='cancelled'){if(['saved','claimed','queued','closed'].includes(row.state))throw held();return save({...row,state:'cancelled'});}
  if(view.state==='preview')return save({...row,sourceFingerprint:view.sourceFingerprint,expectedFingerprint:view.expectedFingerprint,sourcePlatform:voidSourcePlatform(view)});
  if(view.state!=='saved')throw held();
  const replacement=replacementIdentity({replacement:view.replacement});
  return save({...row,sourceFingerprint:view.sourceFingerprint,sourcePlatform:voidSourcePlatform(view),state:row.reason==='OrderCancelled'?'closed':['claimed','queued','closed'].includes(row.state)?row.state:'saved',...(replacement?{replacement}:{} )});
 }
 async function restore(row,view,connection,guard){
  connection.current();guard();row=recordResult(row,view);
  if(view.state!=='saved')throw held();
  void Promise.resolve().then(()=>{connection.current();return w.refreshSavedVoidSales?.(view,connection.current);}).catch(error=>console.warn('Saved receipt refresh is awaiting connection:',error));
  if(row.reason==='OrderCancelled'){await dialog({title:'Order cancelled',text:'The original receipt is voided. Only its applied saved deductions were returned to Live Stocks. No bank refund was made.',icon:'success'});return {saved:true};}
  if(view.replacement.state==='abandoned'){save({...row,state:'closed'});markCompletedCart(row);return {abandoned:true};}
  if(view.replacement.state==='conflict')throw Error('The replacement receipt differs from its saved checkout. Keep the recovery reference for the Owner.');
  if(view.replacement.state==='committed'){save({...row,state:'closed'});markCompletedCart(row);void w.syncOfflineQueue?.();await dialog({title:'Replacement already saved',text:'Its receipt is already recorded. No cart was restored and no second payment was created.',icon:'info'});return {saved:true,replacementSaved:true};}
  if(row.payload||view.replacement.state==='claimed')throw Error('This correction already has a checkout attempt. Use Check receipt correction to recover that exact saved checkout; do not enter another payment.');
  const platform=voidSourcePlatform(view),sameOwnedDraft=cart=>{const owner=cartOwners.get(cart),s=owner?.session,current=session();return owner&&!owner.queued&&owner.operationId===row.operationId&&owner.uid===connection.actor.uid&&owner.sourceFingerprint===row.sourceFingerprint&&view.replacement.state==='draft'&&view.replacement.restoreAttemptId===row.restoreAttemptId&&draftToken(row)===row.restoreAttemptId&&['staffId','name','branch','deviceId','shiftId'].every(key=>s[key]===current[key])&&current.shift?.active===true?owner:null;};
  const currentOwner=sameOwnedDraft(w.cart);if(currentOwner&&checkoutPlatform(w,d)===platform){restoreVoidPlatform(w,d,platform,{switchCart:false});guard.releaseCart?.();active=currentOwner;active.context=connection;active.session=session();active.checkoutCart=null;w.renderCart?.();revealEditableVoidCart(w,d);return {saved:true,restored:true};}
  const target=w.platformCarts?.[platform],targetOwner=Array.isArray(target)&&target!==w.cart?sameOwnedDraft(target):null;
  if(targetOwner){emptyForReplacement(platform,target);connection.current();guard();guard.releaseCart?.();restoreVoidPlatform(w,d,platform);if(w.cart!==target||w.platformCarts[platform]!==target)throw changed();active=targetOwner;active.context=connection;active.session=session();w.renderCart?.();revealEditableVoidCart(w,d);return {saved:true,restored:true};}
  emptyForReplacement(platform);const token=draftToken(row,view.replacement.state==='unclaimed');
  view=await rpc('replacement-claim',row,connection,{phase:'draft',restoreAttemptId:token,expectedFingerprint:row.expectedFingerprint});
  if(view.replacement.state!=='draft'||view.replacement.restoreAttemptId!==token)throw held();
  row=save({...readCurrent(row),restoreAttemptId:token});
  const cart=editableVoidCart(view.replacement.cart);connection.current();guard();
  guard.releaseCart?.();restoreVoidPlatform(w,d,platform);emptyForReplacement(platform);if(platform!=='Standard')d.getElementById('mainOrderType').value=platformOrderType(platform);
  resetCheckoutForNextOrder(w,d);w.isResumedParkedOrder=false;w.isActiveOrderMobile=false;w.activeMobileOrderCode=null;w.activeMobileOrderId=null;w.activeMobileDelivery=null;
  w.cart=cart;if(!w.platformCarts)w.platformCarts={};w.platformCarts[platform]=cart;active={operationId:row.operationId,uid:connection.actor.uid,cart,session:session(),context:connection,sourceFingerprint:row.sourceFingerprint};
  cartOwners.set(cart,active);
  w.renderCart?.();revealEditableVoidCart(w,d);
  await dialog({title:'Order ready to correct',text:'The original receipt is voided. Edit these items, then use normal checkout with a new customer and payment. The replacement keeps one reserved receipt number.',icon:'success'});
  return {saved:true,restored:true};
 }
 async function resolveRow(row,captured){const connected=await connection(row,captured.guard);connected.current();const view=await rpc('status',row,connected);connected.current();return {row:recordResult(row,view),view,connected};}
 async function recover(operationId){ready();const captured=capture({requireOpen:false}),connected=await connection(null,captured.guard,{metadataRecovery:true}),rows=journal.list(connected.actor.uid).filter(row=>!['closed','cancelled'].includes(row.state));let row=operationId?rows.find(item=>item.operationId===operationId):rows.length===1?rows[0]:null;if(!row)throw Error(rows.length?'Choose the original receipt correction. Keep every recovery reference for the Owner.':'No unfinished receipt correction is saved for this cashier.');if(!actorMatches(row,connected.actor,true))throw held();row=await refreshRecoveryPin(row,connected);const view=await rpc('status',row,connected);connected.current();row=await rememberRecoveryAuthority(row,view,connected.actor,connected.current);connected.current();
  if(view.state==='unknown'||view.state==='preview'){
   const answer=await dialog({title:'Receipt save not confirmed',text:'The receipt is not confirmed as voided. Keep this reference to check again, or cancel this exact attempt before reviewing a new one.',showDenyButton:true,denyButtonText:'Cancel this attempt',confirmButtonText:'Keep reference'});connected.current();if(answer.isDenied){const cancelled=await rpc('cancel',row,connected);connected.current();row=recordResult(row,cancelled);if(cancelled.state==='saved')return restore(row,cancelled,connected,captured.guard);if(cancelled.state!=='cancelled')throw held();return {cancelled:true};}return {pending:true};
  }
  if(view.state==='cancelled')return {cancelled:true};
  if(view.replacement?.state==='abandoned'&&row.payload)throw Error('This draft was left without a replacement before its checkout was confirmed. Keep the frozen payment reference for the Owner to review; no new receipt will be created automatically.');
  if(row.payload){
   if(view.replacement?.state==='committed'){save({...row,state:'closed'});markCompletedCart(row);void w.syncOfflineQueue?.();return {replacementSaved:true};}
   if(view.replacement?.state==='conflict')throw held();
   const restoreAttemptId=row.restoreAttemptId;if(typeof restoreAttemptId!=='string'||view.replacement?.restoreAttemptId!==restoreAttemptId||view.replacement?.checkoutAttemptId&&view.replacement.checkoutAttemptId!==row.checkoutAttemptId||view.replacement?.payloadHash&&view.replacement.payloadHash!==row.payloadHash)throw held();
   const local=await w.cashierVoidQueue?.list();connected.current();if(!Array.isArray(local))throw held();const queued=local.find(item=>item.saleId===row.replacement.saleId);if(queued){if(voidCanonical(queued.payload)!==voidCanonical(row.payload))throw held();void w.syncOfflineQueue?.();return {queued:true};}
   emptyForReplacement(row.sourcePlatform||'Standard');const answer=await dialog({title:'Recover the saved replacement checkout',text:'Use the exact earlier checkout and payment details. Do not collect another payment. Its reserved receipt number will be reused.',showCancelButton:true,confirmButtonText:'Recover saved checkout',cancelButtonText:'Keep reference',focusCancel:true});connected.current();if(!answer.isConfirmed)return {pending:true};
   const proof=await rpc('replacement-claim',row,connected,{phase:'checkout',restoreAttemptId,expectedFingerprint:row.expectedFingerprint,checkoutAttemptId:row.checkoutAttemptId,payload:row.payload});connected.current();if(proof.replacement?.state==='committed'){save({...row,state:'closed'});return {replacementSaved:true};}if(proof.replacement?.state!=='claimed'||proof.replacement.payloadHash!==row.payloadHash||proof.replacement.checkoutAttemptId!==row.checkoutAttemptId)throw held();
   await w.cashierVoidQueue.enqueue(voidClone(row.payload));connected.current();save({...row,state:'queued'});void w.syncOfflineQueue?.();return {queued:true};
  }
  if(view.replacement?.state==='abandoned'){save({...row,state:'closed'});markCompletedCart(row);return {abandoned:true};}
  const unpaidConflict=view.replacement?.state==='conflict'&&!row.payload&&!view.replacement.checkoutAttemptId&&!view.replacement.payloadHash;
  if(row.reason==='WrongPunched'&&(['unclaimed','draft'].includes(view.replacement?.state)||unpaidConflict)){
   const canRestore=!unpaidConflict&&w.currentShift?.active===true&&w.currentShift.shiftId===row.shiftId;
   const answer=await dialog({title:'The original receipt is already voided',text:canRestore?'Restore its editable order, or leave it without a replacement. No original payment is refunded automatically.':unpaidConflict?'This reserved replacement is held for review. An unpaid draft may be left without a new order only after its saved records are checked. Any existing receipt or payment attempt must stay for Owner review.':'Its original shift is no longer open here. You can leave this unpaid correction without a new order; any payment attempt must stay for Owner review.',showConfirmButton:canRestore,showCancelButton:true,showDenyButton:true,confirmButtonText:'Restore editable order',denyButtonText:'Leave without new order',cancelButtonText:'Keep reference',focusCancel:true});connected.current();if(answer.isDenied)return abandon(row,view,connected,captured.guard);if(!answer.isConfirmed)return {pending:true};if(!canRestore)throw Error('Only the original open shift can restore this correction.');
  }
  return restore(row,view,connected,captured.guard);
 }
 async function abandon(row,view,connected,guard){
  const unpaidConflict=view.replacement?.state==='conflict'&&!view.replacement.checkoutAttemptId&&!view.replacement.payloadHash;
  if(row.payload||!['unclaimed','draft'].includes(view.replacement?.state)&&!unpaidConflict)throw Error('This correction already has a checkout attempt. Keep its exact saved payment and use recovery or ask the Owner; it cannot be discarded.');
  const answer=await dialog({title:'Leave this void without a new order?',text:'The original receipt stays voided and its saved stock reversal stays recorded. No replacement receipt or automatic refund will be made. This cannot be used to discard a queued payment.',showCancelButton:true,confirmButtonText:'Leave without new order',cancelButtonText:'Keep correction',focusCancel:true});connected.current();guard();if(!answer.isConfirmed)return {pending:true};
  const token=draftToken(row,view.replacement.state==='unclaimed'||unpaidConflict&&!row.restoreAttemptId);
  const result=await rpc('replacement-claim',row,connected,{phase:'abandon',restoreAttemptId:token,expectedFingerprint:row.expectedFingerprint});connected.current();guard();if(result.replacement?.state!=='abandoned')throw held();save({...readCurrent(row),state:'closed'});
  const owner=cartOwners.get(w.cart);if(owner?.operationId===row.operationId){cartOwners.delete(w.cart);active=null;w.cart=[];resetCheckoutForNextOrder(w,d);w.renderCart?.();}return {abandoned:true};
 }
 async function readPreview(row,connected,captured){
  for(let attempts=0;attempts<3;attempts++){
   try{return {row,view:await rpc('preview',row,connected,row.ownerUnitReview?{ownerUnitReview:row.ownerUnitReview}:{})};}
   catch(error){connected.current();const review=legacyVoidUnitReview(error,readCurrent(row),connected.api.auth.currentUser);if(!review)throw error;
    const answer=await dialog({title:'Owner review of older stock units',html:legacyVoidUnitMarkup(review,row.receiptId),input:'textarea',inputLabel:'Owner reason (8–1000 characters)',inputAttributes:{maxlength:'1000'},inputValidator:value=>validLegacyVoidReason(value)?undefined:'Enter an Owner reason using 8–1000 characters.',showCancelButton:true,confirmButtonText:'I checked these units · review void',cancelButtonText:'Keep reference',focusCancel:true,preConfirm:value=>{if(!validLegacyVoidReason(value)||review.rows.some((_,index)=>d.getElementById('void-unit-ack-'+index)?.checked!==true)){w.Swal.showValidationMessage?.('Check every saved item/unit and enter your Owner reason before continuing.');return false;}return {confirmed:true,reason:value.trim()};}});connected.current();captured.guard();
    if(!answer.isConfirmed)return {pending:true,unitReview:true};
    if(answer.value?.confirmed!==true||!validLegacyVoidReason(answer.value.reason))throw Error('The Owner unit review was not confirmed. Keep the original reference.');
    row=save({...readCurrent(row),ownerUnitReview:{confirmed:true,fingerprint:review.fingerprint,reason:answer.value.reason.trim()}});
   }
  }
  throw Error('The saved stock review changed repeatedly. Keep this receipt reference for the Owner.');
 }
 async function previewRejected(row,connected,captured,error){
  const current=readCurrent(row);
  if(current.state!=='pending'||current.commitStarted!==false||!([400,409].includes(error.status)||error.status===403&&['cashier-void/original-cashier-required','cashier-void/original-pin-required'].includes(error.code))||typeof error.code!=='string'||!/^cashier-void\/[a-z0-9-]{1,80}$/.test(error.code))throw error;
  const answer=await dialog({title:'Receipt review was not completed',text:error.message+' Keep reference '+row.receiptId+'. Check its saved result, or cancel this same review attempt. The current order stays unchanged.',showDenyButton:true,showCancelButton:true,confirmButtonText:'Check saved result',denyButtonText:'Cancel this review attempt',cancelButtonText:'Keep reference',focusCancel:true});connected.current();captured.guard();
  if(answer.isDenied){const view=await rpc('cancel',row,connected);connected.current();row=recordResult(row,view);if(view.state==='saved')return restore(row,view,connected,captured.guard);if(view.state!=='cancelled')throw held();await dialog({title:'Review attempt cancelled',text:'This exact review reference is closed. It did not void the receipt. Check the receipt in Shift Sales before starting another review.',icon:'info'});return {cancelled:true};}
  if(answer.isConfirmed)return recover(row.operationId);
  return {pending:true,previewRejected:true,reference:row.operationId};
 }
 async function start(saleId,receiptId){
  ready();if(!voidId(saleId)||!voidId(receiptId)||saleId.startsWith('LOCAL-'))throw Error('Select an uploaded receipt with an exact saved reference.');
  const captured=capture(),choice=await dialog({title:'Why are you voiding this order?',text:'Receipt '+receiptId,showDenyButton:true,showCancelButton:true,confirmButtonText:'Order cancelled',denyButtonText:'Wrong punched items',cancelButtonText:'Keep receipt',focusCancel:true});captured.guard();
  const reason=choice.isConfirmed?'OrderCancelled':choice.isDenied?'WrongPunched':null;if(!reason)return {cancelled:true};if(reason==='WrongPunched')emptyForReplacement();
  const connected=await connection(null,captured.guard),actor=connected.actor;connected.current();const pending=journal.list(actor.uid).filter(row=>!['closed','cancelled'].includes(row.state));
  if(pending.length){const original=pending[0];if(pending.length!==1||original.saleId!==saleId||original.receiptId!==receiptId||original.reason!==reason||original.shiftId!==captured.start.shiftId||!actorMatches(original,actor,true))throw held();const answer=await dialog({title:'Check the saved receipt review first',text:'Receipt '+original.receiptId+' already has a saved review. No new void was started. Check that exact result before reviewing it again.',showCancelButton:true,confirmButtonText:'Check saved review',cancelButtonText:'Keep current order',focusCancel:true});connected.current();if(answer.isConfirmed)return recover(original.operationId);return {pending:true,reference:original.operationId};}
  const operationId=makeId(),receiptScope=await voidPayloadHash({operationId,saleId,receiptId,branch:actor.branch,shiftId:captured.start.shiftId,reason},w.crypto);connected.current();const pinProof=await connected.confirmReceiptPin(receiptScope);connected.current();
  let row=save({version:1,operationId,scope:JSON.stringify(actor),saleId,receiptId,reason,branch:actor.branch,shiftId:captured.start.shiftId,state:'pending',sourceFingerprint:null,commitStarted:false,pinVerificationId:pinProof.verificationId,pinExpiresAt:pinProof.expiresAt,createdAt:now()}),view;
  try{const result=await readPreview(row,connected,captured);if(result.pending)return result;row=result.row;view=result.view;}catch(error){connected.current();return previewRejected(row,connected,captured,error);}
  connected.current();row=recordResult(row,view);if(view.state==='saved')return restore(row,view,connected,captured.guard);if(view.state!=='preview')throw held();
  if(reason==='WrongPunched')emptyForReplacement(voidSourcePlatform(view));
  const answer=await dialog({title:reason==='WrongPunched'?'Void and correct this order?':'Cancel this saved order?',html:voidPreviewMarkup(view),showCancelButton:true,confirmButtonText:reason==='WrongPunched'?'Void and restore items':'Void order',cancelButtonText:'Keep receipt',focusCancel:true});connected.current();
  if(!answer.isConfirmed){const result=await rpc('cancel',row,connected);connected.current();row=recordResult(row,result);if(result.state==='saved')return restore(row,result,connected,captured.guard);if(result.state!=='cancelled')throw held();return {cancelled:true};}
  if(reason==='WrongPunched')emptyForReplacement(voidSourcePlatform(view));row=save({...readCurrent(row),commitStarted:true});view=await rpc('commit',row,connected,{expectedFingerprint:row.expectedFingerprint});connected.current();row=recordResult(row,view);if(view.state!=='saved')throw held();const result=await restore(row,view,connected,captured.guard);return result;
 }
 function checkoutRow(payload){active=cartOwners.get(w.cart)||null;if(!active)return null;if(active.queued)throw Error('This replacement order is already queued. Clear the completed cart before entering another customer.');const row=journal.get(active.uid,active.operationId);if(!row||!['saved','claimed'].includes(row.state)||row.reason!=='WrongPunched')throw held();const s=active.session,current=session();if(current.person!==s.person||current.uid!==s.uid||current.staffId!==s.staffId||current.name!==s.name||current.branch!==s.branch||current.deviceId!==s.deviceId||current.shift!==s.shift||current.shiftId!==s.shiftId||!current.shift?.active||w.cart!==active.cart||checkoutPlatform(w,d)!==(row.sourcePlatform||'Standard')||payload.branch!==s.branch||payload.shiftId!==s.shiftId||active.checkoutCart&&voidCanonical(w.cart)!==active.checkoutCart)throw changed();active.context.current();return row;}
 const service={journal,
  start:(saleId,receiptId)=>run(()=>start(saleId,receiptId)),recover:op=>run(()=>recover(op)),
  invalidate(){generation++;active=null;access.invalidate();},
  blockLogout(){
   try{const current=session(),rows=journal.forOperator(current);if(!rows.some(row=>!['closed','cancelled'].includes(row.state)&&(row.state==='pending'||!!row.payload)))return false;}
   catch{}
   void dialog({title:'Check the saved receipt correction first',text:'A receipt change or replacement payment is still awaiting confirmation. Use Check receipt correction and finish its saved result before signing out. Keep this tablet’s app data; the Owner can review an unresolved reference.',icon:'warning'});
   return true;
  },
  async prepareCheckout(payload){const owner=cartOwners.get(w.cart);if(owner)owner.checkoutCart=null;const row=checkoutRow(payload);if(!row)return null;active.checkoutCart=voidCanonical(w.cart);const platform=row.sourcePlatform||'Standard';if(payload.isMobileOrder||payload.resumeRecoveryId||payload.wasParked||payload.mealIdentityId||/salary|deduction/i.test(payload.paymentMethod||'')||payload.deliveryFee>0||/delivery/i.test(payload.orderType||'')||platform==='Standard'&&/grab|panda/i.test(payload.paymentMethod||''))throw Error('Use the saved receipt’s supported channel. Ask the Owner to review meals, delivery or linked orders separately.');if(platform!=='Standard'&&(payload.paymentMethod!==platform||!['grab','foodpanda','panda'].includes(platformKey(payload.orderType))||platform==='Grab'&&platformKey(payload.orderType)!=='grab'||platform==='Foodpanda'&&!['foodpanda','panda'].includes(platformKey(payload.orderType))||typeof payload.platformOrderId!=='string'||!payload.platformOrderId.trim()||payload.platformOrderId.length>200||/[\u0000-\u001f\u007f]/.test(payload.platformOrderId)))throw Error('Re-enter the '+platform+' order reference through normal checkout and check the provider’s records. It may be the same external order; the old payment fields are cleared.');if(row.payload)throw Error('This correction has a saved checkout attempt. Use Check receipt correction before taking another payment.');const view=await rpc('status',row,active.context);checkoutRow(payload);if(view.replacement?.state!=='draft'||view.replacement.restoreAttemptId!==draftToken(row))throw held();return {...row.replacement,operationId:row.operationId};},
  assertCheckout:payload=>checkoutRow(payload),
  saleConnection(payload){
   if(!payload.voidCorrection){const row=checkoutRow(payload);if(!row)throw held();const api=active.context.api;active.context.current();return {api,user:api.auth.currentUser,uid:active.uid};}
   const proof=writers.get(payload.voidCorrection.operationId),row=proof&&journal.get(proof.uid,payload.voidCorrection.operationId);if(!row||voidCanonical(row.payload)!==voidCanonical(payload))throw held();return proof;
  },
  activeCorrection:()=>!!cartOwners.get(w.cart)&&!cartOwners.get(w.cart).queued,
  ownsCart:()=>!!cartOwners.get(w.cart),
  abandonActive:()=>run(async()=>{
   ready();const captured=capture({requireOpen:false}),owner=cartOwners.get(w.cart);if(!owner||owner.queued)throw held();
   let row=journal.get(owner.uid,owner.operationId);if(!row)throw held();
   const connected=await connection(row,captured.guard,{metadataRecovery:true}),view=await rpc('status',row,connected);connected.current();
   row=await rememberRecoveryAuthority(row,view,connected.actor,connected.current);connected.current();return abandon(row,view,connected,captured.guard);
  }),
  async freezeCheckout(payload){
   const row=checkoutRow(payload);if(!row)return payload;
   if(payload.saleId!==row.replacement.saleId||payload.receiptId!==row.replacement.receiptId)throw held();
   const restoreAttemptId=draftToken(row),attempt=makeAttempt();
   payload.voidCorrection={schemaVersion:1,operationId:row.operationId,sourceSaleId:row.saleId,sourceReceiptId:row.receiptId,sourceFingerprint:row.sourceFingerprint,checkoutAttemptId:attempt,claimTokenHash:await voidTokenHash(row.replacement.claimToken,w.crypto)};
   const copy=voidClone(payload),payloadHash=await voidPayloadHash(copy,w.crypto);checkoutRow(payload);
   const saved=save({...row,state:'claimed',checkoutAttemptId:attempt,payloadHash,payload:copy});
   const view=await rpc('replacement-claim',saved,active.context,{phase:'checkout',restoreAttemptId,expectedFingerprint:row.expectedFingerprint,checkoutAttemptId:attempt,payload:copy});checkoutRow(payload);
   if(view.replacement?.state!=='claimed'||view.replacement.checkoutAttemptId!==attempt||view.replacement.payloadHash!==payloadHash)throw held();
   return copy;
  },
  queued(payload){if(!payload.voidCorrection)return;const row=journal.get(active?.uid||session().uid?.uid,payload.voidCorrection.operationId);if(!row||voidCanonical(row.payload)!==voidCanonical(payload))throw held();save({...row,state:'queued'});if(active)active.queued=true;active=null;},
  async verifyQueued(payload){const info=payload.voidCorrection;if(!info||!voidId(info.operationId))throw held();const captured=capture({cart:false,requireOpen:false}),connected=await connection(null,captured.guard,{metadataRecovery:true}),row=journal.get(connected.actor.uid,info.operationId);if(!row||!actorMatches(row,connected.actor)||voidCanonical(row.payload)!==voidCanonical(payload)||row.payloadHash!==await voidPayloadHash(payload,w.crypto))throw held();connected.current();const checked=await refreshRecoveryPin(row,connected),view=await rpc('status',checked,connected);connected.current();if(view.state!=='saved'||view.replacement?.checkoutAttemptId!==row.checkoutAttemptId||view.replacement?.payloadHash!==row.payloadHash||!['claimed','committed'].includes(view.replacement?.state))throw held();writers.set(info.operationId,{api:connected.api,user:connected.api.auth.currentUser,uid:connected.actor.uid});return view.replacement.state==='committed';},
  async acknowledge(payload){if(!payload.voidCorrection)return;if(!await service.verifyQueued(payload))throw Error('The replacement receipt is not yet confirmed. It remains queued on this tablet.');const actor=access.capture();const api=await actor.resolve();actor.current();const row=journal.get(actor.actor().uid,payload.voidCorrection.operationId);if(!row)throw held();save({...row,state:'closed'});},
  renderRecovery(){const box=placeCashierVoidRecovery(d);if(!box)return;box.replaceChildren();const button=d.createElement('button');button.type='button';button.textContent='Check receipt correction';button.onclick=()=>service.recover();box.append(button);try{for(const row of journal.forOperator(session()).filter(row=>!['closed','cancelled'].includes(row.state))){const note=d.createElement('p');note.textContent='Saved correction for '+row.receiptId+' · '+(row.payload?'keep its original checkout and payment for confirmation':'check its saved void result before starting another attempt');box.append(note);const check=d.createElement('button');check.type='button';check.textContent='Check correction for '+row.receiptId;check.onclick=()=>service.recover(row.operationId);box.append(check);}}catch{const note=d.createElement('p');note.textContent='A saved receipt correction needs Owner review. Keep this tablet’s app data.';box.append(note);}}
 };
 async function run(work){if(flight)return flight;flight=(async()=>{try{return await work();}catch(error){if(error.code==='cashier-void/cancelled')return {cancelled:true};const message=['cashier-void/approval-required','access/approval'].includes(error.code)?'This tablet or employee setup is not confirmed for receipt changes. Keep any saved correction reference and ask the Owner to review the existing setup. Normal Cashier work is unchanged.':error.message;await dialog({title:'Receipt correction needs attention',text:message,icon:'warning'});return {error:message};}finally{service.renderRecovery();}})();flight.finally(()=>flight=null).catch(()=>{});return flight;}
 w.cashierVoid=service;return service;
}
