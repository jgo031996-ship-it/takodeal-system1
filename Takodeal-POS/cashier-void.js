import {resetCheckoutForNextOrder} from './checkout-controls.js';
import {createVoidJournal,editableVoidCart,validateVoidView,voidCanonical,voidClone,voidHash,voidId,voidPayloadHash,voidTokenHash} from './cashier-void-model.js';

export const CASHIER_VOID_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/cashier-void/';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const held=()=>Error('This receipt still has a saved correction to check. Keep this tablet’s app data and use Check receipt correction.');
const changed=()=>Error('The cashier, branch, shift or order changed. Reopen the saved correction before continuing.');
const replacementIdentity=row=>row.replacement&&({saleId:row.replacement.saleId,receiptId:row.replacement.receiptId,claimToken:row.replacement.claimToken});

export function voidPreviewMarkup(view){
 const amount=typeof view.source?.netTotal==='number'&&Number.isFinite(view.source.netTotal)?'₱'+view.source.netTotal.toFixed(2):'Saved amount unavailable';
 const movements=Array.isArray(view.effects)?view.effects:[];
 return '<p class="cashier-void-source"><strong>'+esc(view.sourceReceiptId)+'</strong><span>'+esc(view.branch)+' · '+esc(amount)+'</span></p>'+
  '<p>'+ (view.reason==='WrongPunched'?'The original receipt will be voided. Its items return to an editable order for a new checkout.':'The original receipt will be voided.')+'</p>'+
  '<p>Only saved deductions that were already applied return to Live Stocks. No bank payment is refunded automatically. Confirm that these ingredients were unused or physically returned; ask the Owner to record waste separately.</p>'+
  (movements.length?'<div class="cashier-void-movements">'+movements.map(row=>'<article><strong>'+esc(row.name)+'</strong><span><small>Before</small><b>'+esc(row.beforeStock)+' '+esc(row.unit)+'</b></span><span><small>After</small><b>'+esc(row.afterStock)+' '+esc(row.unit)+'</b></span></article>').join('')+'</div>':'<p class="cashier-void-note">No applied stock deduction will be added back.</p>')+
  (view.reason==='WrongPunched'?'<p class="cashier-void-note">Review the restored items, prices and options. Enter a new customer and payment through normal checkout. Previous payment and discount approvals are cleared.</p>':'');
}

export function installCashierVoid(w=window,d=document,{access=w.cashierVoidAccess,fetcher=w.fetch?.bind(w)||globalThis.fetch,timeoutMs=25000,makeId=()=> 'void-'+w.crypto.randomUUID(),makeAttempt=()=>w.crypto.randomUUID(),now=Date.now}={}){
 if(w.cashierVoid)return w.cashierVoid;
 if(typeof access?.capture!=='function')throw Error('Receipt correction is still loading. Reopen Shift Sales.');
 const journal=createVoidJournal(w.localStorage),physical=new Map(),cartOwners=new WeakMap();let flight=null,active=null,generation=0;
 const tabKey=op=>'takodeal_void_draft_tab_v1:'+op;
 function draftToken(row,create=false){const key=tabKey(row.operationId);let token=w.sessionStorage?.getItem(key);if(!token&&create){token=makeAttempt();w.sessionStorage?.setItem(key,token);if(w.sessionStorage?.getItem(key)!==token)throw Error('This tab cannot retain the correction recovery reference. No editable order was restored.');}if(!token||row.restoreAttemptId&&row.restoreAttemptId!==token)throw Error('This replacement belongs to its original tab. Reopen that tab or ask the Owner to review its saved correction.');return token;}
 const dialog=options=>w.Swal.fire({customClass:{popup:'cashier-void-modal'},confirmButtonColor:'#c65c24',cancelButtonColor:'#64748b',allowOutsideClick:false,...options});
 const session=()=>({person:w.sessionUser,uid:w.auth?.currentUser,staffId:w.sessionUser?.staffId||w.sessionUser?.id,name:w.sessionUser?.cashierName,branch:w.localStorage.getItem('takodeal_device_branch'),deviceId:w.localStorage.getItem('takodeal_device_id'),shift:w.currentShift,shiftId:w.currentShift?.shiftId});
 function capture({cart=true,requireOpen=true}={}){
  const start=session(),epoch=generation,order=w.cart,serialized=voidCanonical(order),platform=w.posPlatform;let checkCart=cart;
  const guard=()=>{const current=session();if(epoch!==generation||current.person!==start.person||current.uid!==start.uid||current.staffId!==start.staffId||current.name!==start.name||current.branch!==start.branch||current.deviceId!==start.deviceId||current.shift!==start.shift||current.shiftId!==start.shiftId||requireOpen&&(!current.shift?.active||!voidId(start.shiftId))||w.sessionUser?.branch!==start.branch||!voidId(start.staffId)||checkCart&&(w.cart!==order||voidCanonical(w.cart)!==serialized||w.posPlatform!==platform))throw changed();};
  guard.releaseCart=()=>{checkCart=false;};
  guard();return {start,guard};
 }
 function emptyStandard(){if(w.posPlatform!=='Standard'||!Array.isArray(w.cart)||w.cart.length||w.isActiveOrderMobile||w.parkedRecovery?.activeId?.())throw Error('Keep the current order safe: return to POS and park it first, then reopen this receipt with an empty Standard cart.');}
 function ready(){if(!voidId(w.sessionUser?.staffId||w.sessionUser?.id))throw Error('This sign-in is not confirmed for receipt changes. Ask the Owner to review this tablet’s existing setup. Normal Cashier work is unchanged.');if(w.navigator?.onLine===false)throw Error('Connect this tablet before changing a saved receipt. Pending sales and the current cart stay on this device.');if(w.isProcessingOrder||w.isSubmittingOrder||w.cashierRemitSubmitting||w.cashierCashCountActive)throw Error('Finish the current payment or cash count before correcting a receipt.');}
 function save(row){return journal.put(row);}
 function markCompletedCart(row){const owner=cartOwners.get(w.cart);if(owner?.operationId===row.operationId){owner.queued=true;active=null;}}
 function readCurrent(row){const saved=journal.get(JSON.parse(row.scope).uid,row.operationId);if(!saved||saved.scope!==row.scope||saved.reason!==row.reason||saved.saleId!==row.saleId)throw held();return saved;}
 function actorMatches(row,actor,metadataRecovery=false){const original=JSON.parse(row.scope);return ['uid','staffId','deviceId','branch'].every(key=>original[key]===actor[key])&&(actor.staffSessionId===(row.recoverySessionId||original.staffSessionId)||metadataRecovery&&['saved','claimed','queued'].includes(row.state)&&!!row.replacement);}
 async function connection(row,guard,{metadataRecovery=false}={}){
  guard();const context=access.capture({metadataRecovery}),api=await context.resolve();
  guard();const actor=context.actor();
  if(row&&!actorMatches(row,actor,metadataRecovery))throw held();
  return {actor,api,current(){guard();context.current();if(row)readCurrent(row);}};
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
  const body={deviceId:actor.deviceId,staffId:actor.staffId,sessionId:actor.staffSessionId,branch:row.branch,shiftId:row.shiftId,saleId:row.saleId,receiptId:row.receiptId,reason:row.reason,operationId:row.operationId,...(route==='replacement-claim'?{claimToken:row.replacement?.claimToken}:{}),...extra};
  const work=(async()=>{connection.current();const token=await connection.api.auth.currentUser.getIdToken();connection.current();if(controller.signal.aborted)throw held();const response=await fetcher(CASHIER_VOID_ENDPOINT+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});connection.current();if(response.redirected||response.type==='opaque'||response.url&&response.url!==CASHIER_VOID_ENDPOINT+route)throw held();const raw=await response.text();connection.current();if(raw.length>1_000_000)throw held();let result;try{result=JSON.parse(raw);}catch{throw held();}if(!response.ok)throw Object.assign(Error(typeof result?.message==='string'?result.message.slice(0,1000):'The receipt result is not confirmed. Check the same saved correction.'),{code:result?.code,status:response.status});return validateVoidView(result,row);})();
  physical.set(slot,work);work.finally(()=>{if(physical.get(slot)===work)physical.delete(slot);}).catch(()=>{});
  try{return await Promise.race([work,new Promise((_,reject)=>timer=setTimeout(()=>{controller.abort();reject(Error('The result is not confirmed yet. Keep this tablet’s app data and use Check receipt correction; do not start another void.'));},timeoutMs))]);}finally{clearTimeout(timer);}
 }
 function recordResult(row,view){
  row=readCurrent(row);
  if(view.state==='unknown')return row;
  if(view.state==='cancelled'){if(['saved','claimed','queued','closed'].includes(row.state))throw held();return save({...row,state:'cancelled'});}
  if(view.state==='preview')return save({...row,sourceFingerprint:view.sourceFingerprint,expectedFingerprint:view.expectedFingerprint});
  if(view.state!=='saved')throw held();
  const replacement=replacementIdentity({replacement:view.replacement});
  return save({...row,sourceFingerprint:view.sourceFingerprint,state:row.reason==='OrderCancelled'?'closed':['claimed','queued','closed'].includes(row.state)?row.state:'saved',...(replacement?{replacement}:{} )});
 }
 async function restore(row,view,connection,guard){
  connection.current();guard();row=recordResult(row,view);
  if(view.state!=='saved')throw held();
  if(row.reason==='OrderCancelled'){await dialog({title:'Order cancelled',text:'The original receipt is voided. Only its applied saved deductions were returned to Live Stocks. No bank refund was made.',icon:'success'});return {saved:true};}
  if(view.replacement.state==='abandoned'){save({...row,state:'closed'});markCompletedCart(row);return {abandoned:true};}
  if(view.replacement.state==='conflict')throw Error('The replacement receipt differs from its saved checkout. Keep the recovery reference for the Owner.');
  if(view.replacement.state==='committed'){save({...row,state:'closed'});markCompletedCart(row);void w.syncOfflineQueue?.();await dialog({title:'Replacement already saved',text:'Its receipt is already recorded. No cart was restored and no second payment was created.',icon:'info'});return {saved:true,replacementSaved:true};}
  if(row.payload||view.replacement.state==='claimed')throw Error('This correction already has a checkout attempt. Use Check receipt correction to recover that exact saved checkout; do not enter another payment.');
  if(active?.operationId===row.operationId&&w.cart===active.cart)return {saved:true,restored:true};
  emptyStandard();const token=draftToken(row,view.replacement.state==='unclaimed');
  view=await rpc('replacement-claim',row,connection,{phase:'draft',restoreAttemptId:token,expectedFingerprint:row.expectedFingerprint});
  if(view.replacement.state!=='draft'||view.replacement.restoreAttemptId!==token)throw held();
  row=save({...readCurrent(row),restoreAttemptId:token});
  const cart=editableVoidCart(view.replacement.cart);connection.current();guard();
  resetCheckoutForNextOrder(w,d);w.isResumedParkedOrder=false;w.isActiveOrderMobile=false;w.activeMobileOrderCode=null;w.activeMobileOrderId=null;w.activeMobileDelivery=null;
  w.cart=cart;guard.releaseCart?.();active={operationId:row.operationId,uid:connection.actor.uid,cart,session:session(),context:connection,sourceFingerprint:row.sourceFingerprint};
  cartOwners.set(cart,active);
  w.renderCart?.();w.showView?.('pos');w.switchView?.('pos');
  await dialog({title:'Order ready to correct',text:'The original receipt is voided. Edit these items, then use normal checkout with a new customer and payment. The replacement keeps one reserved receipt number.',icon:'success'});
  return {saved:true,restored:true};
 }
 async function resolveRow(row,captured){const connected=await connection(row,captured.guard);connected.current();const view=await rpc('status',row,connected);connected.current();return {row:recordResult(row,view),view,connected};}
 async function recover(operationId){ready();const captured=capture({requireOpen:false}),connected=await connection(null,captured.guard,{metadataRecovery:true}),rows=journal.list(connected.actor.uid).filter(row=>!['closed','cancelled'].includes(row.state));let row=operationId?rows.find(item=>item.operationId===operationId):rows.length===1?rows[0]:null;if(!row)throw Error(rows.length?'Choose the original receipt correction. Keep every recovery reference for the Owner.':'No unfinished receipt correction is saved for this cashier.');if(!actorMatches(row,connected.actor,true))throw held();const view=await rpc('status',row,connected);connected.current();row=await rememberRecoveryAuthority(row,view,connected.actor,connected.current);connected.current();
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
   emptyStandard();const answer=await dialog({title:'Recover the saved replacement checkout',text:'Use the exact earlier checkout and payment details. Do not collect another payment. Its reserved receipt number will be reused.',showCancelButton:true,confirmButtonText:'Recover saved checkout',cancelButtonText:'Keep reference',focusCancel:true});connected.current();if(!answer.isConfirmed)return {pending:true};
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
 async function start(saleId,receiptId){ready();if(!voidId(saleId)||!voidId(receiptId)||saleId.startsWith('LOCAL-'))throw Error('Select an uploaded receipt with an exact saved reference.');const captured=capture();const choice=await dialog({title:'Why are you voiding this order?',text:'Receipt '+receiptId,showDenyButton:true,showCancelButton:true,confirmButtonText:'Order cancelled',denyButtonText:'Wrong punched items',cancelButtonText:'Keep receipt',focusCancel:true});captured.guard();const reason=choice.isConfirmed?'OrderCancelled':choice.isDenied?'WrongPunched':null;if(!reason)return {cancelled:true};if(reason==='WrongPunched')emptyStandard();const connected=await connection(null,captured.guard),actor=connected.actor;connected.current();const pending=journal.list(actor.uid).filter(row=>!['closed','cancelled'].includes(row.state));if(pending.length)throw held();let row=save({version:1,operationId:makeId(),scope:JSON.stringify(actor),saleId,receiptId,reason,branch:actor.branch,shiftId:captured.start.shiftId,state:'pending',sourceFingerprint:null,createdAt:now()});let view=await rpc('preview',row,connected);connected.current();row=recordResult(row,view);if(view.state==='saved')return restore(row,view,connected,captured.guard);if(view.state!=='preview')throw held();const answer=await dialog({title:reason==='WrongPunched'?'Void and correct this order?':'Cancel this saved order?',html:voidPreviewMarkup(view),showCancelButton:true,confirmButtonText:reason==='WrongPunched'?'Void and restore items':'Void order',cancelButtonText:'Keep receipt',focusCancel:true});connected.current();if(!answer.isConfirmed){const result=await rpc('cancel',row,connected);connected.current();row=recordResult(row,result);if(result.state==='saved')return restore(row,result,connected,captured.guard);if(result.state!=='cancelled')throw held();return {cancelled:true};}if(reason==='WrongPunched')emptyStandard();view=await rpc('commit',row,connected,{expectedFingerprint:row.expectedFingerprint});connected.current();row=recordResult(row,view);if(view.state!=='saved')throw held();const result=await restore(row,view,connected,captured.guard);void w.loadSalesDashboard?.();return result;}
 function checkoutRow(payload){active=cartOwners.get(w.cart)||null;if(!active)return null;if(active.queued)throw Error('This replacement order is already queued. Clear the completed cart before entering another customer.');const s=active.session,current=session();if(current.person!==s.person||current.uid!==s.uid||current.staffId!==s.staffId||current.name!==s.name||current.branch!==s.branch||current.deviceId!==s.deviceId||current.shift!==s.shift||current.shiftId!==s.shiftId||!current.shift?.active||w.cart!==active.cart||w.posPlatform!=='Standard'||payload.branch!==s.branch||payload.shiftId!==s.shiftId||active.checkoutCart&&voidCanonical(w.cart)!==active.checkoutCart)throw changed();const row=journal.get(active.uid,active.operationId);if(!row||!['saved','claimed'].includes(row.state)||row.reason!=='WrongPunched')throw held();active.context.current();return row;}
 const service={journal,
  start:(saleId,receiptId)=>run(()=>start(saleId,receiptId)),recover:op=>run(()=>recover(op)),
  invalidate(){generation++;active=null;access.invalidate();},
  blockLogout(){
   try{const current=session(),rows=journal.forOperator(current);if(!rows.some(row=>!['closed','cancelled'].includes(row.state)&&(row.state==='pending'||!!row.payload)))return false;}
   catch{}
   void dialog({title:'Check the saved receipt correction first',text:'A receipt change or replacement payment is still awaiting confirmation. Use Check receipt correction and finish its saved result before signing out. Keep this tablet’s app data; the Owner can review an unresolved reference.',icon:'warning'});
   return true;
  },
  async prepareCheckout(payload){const owner=cartOwners.get(w.cart);if(owner)owner.checkoutCart=null;const row=checkoutRow(payload);if(!row)return null;active.checkoutCart=voidCanonical(w.cart);if(payload.isMobileOrder||payload.resumeRecoveryId||payload.wasParked||payload.mealIdentityId||/grab|panda|salary|deduction/i.test(payload.paymentMethod||'')||payload.deliveryFee>0||/delivery/i.test(payload.orderType||''))throw Error('Use ordinary counter checkout for this correction. Ask the Owner to review meals, delivery and platform orders separately.');if(row.payload)throw Error('This correction has a saved checkout attempt. Use Check receipt correction before taking another payment.');const view=await rpc('status',row,active.context);checkoutRow(payload);if(view.replacement?.state!=='draft'||view.replacement.restoreAttemptId!==draftToken(row))throw held();return {...row.replacement,operationId:row.operationId};},
  assertCheckout:payload=>checkoutRow(payload),
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
  async verifyQueued(payload){const info=payload.voidCorrection;if(!info||!voidId(info.operationId))throw held();const captured=capture({cart:false,requireOpen:false}),connected=await connection(null,captured.guard),row=journal.get(connected.actor.uid,info.operationId);if(!row||!actorMatches(row,connected.actor)||voidCanonical(row.payload)!==voidCanonical(payload)||row.payloadHash!==await voidPayloadHash(payload,w.crypto))throw held();connected.current();const view=await rpc('status',row,connected);connected.current();if(view.state!=='saved'||view.replacement?.checkoutAttemptId!==row.checkoutAttemptId||view.replacement?.payloadHash!==row.payloadHash||!['claimed','committed'].includes(view.replacement?.state))throw held();return view.replacement.state==='committed';},
  async acknowledge(payload){if(!payload.voidCorrection)return;if(!await service.verifyQueued(payload))throw Error('The replacement receipt is not yet confirmed. It remains queued on this tablet.');const actor=access.capture();const api=await actor.resolve();actor.current();const row=journal.get(actor.actor().uid,payload.voidCorrection.operationId);if(!row)throw held();save({...row,state:'closed'});},
  renderRecovery(){let box=d.getElementById?.('cashierVoidRecovery');if(!box){const host=d.getElementById?.('view-sales');if(!host||!d.createElement)return;box=d.createElement('div');box.id='cashierVoidRecovery';box.className='cashier-void-recovery';host.prepend(box);}box.replaceChildren();const button=d.createElement('button');button.type='button';button.textContent='Check receipt correction';button.onclick=()=>service.recover();box.append(button);try{for(const row of journal.forOperator(session()).filter(row=>!['closed','cancelled'].includes(row.state))){const note=d.createElement('p');note.textContent='Saved correction for '+row.receiptId+' · '+(row.payload?'keep its original checkout and payment for confirmation':'check its saved void result before starting another attempt');box.append(note);}}catch{const note=d.createElement('p');note.textContent='A saved receipt correction needs Owner review. Keep this tablet’s app data.';box.append(note);}}
 };
 async function run(work){if(flight)return flight;flight=(async()=>{try{return await work();}catch(error){if(error.code==='cashier-void/cancelled')return {cancelled:true};const message=['cashier-void/approval-required','access/approval'].includes(error.code)?'This tablet or employee setup is not confirmed for receipt changes. Keep any saved correction reference and ask the Owner to review the existing setup. Normal Cashier work is unchanged.':error.message;await dialog({title:'Receipt correction needs attention',text:message,icon:'warning'});return {error:message};}finally{service.renderRecovery();}})();flight.finally(()=>flight=null).catch(()=>{});return flight;}
 w.cashierVoid=service;return service;
}
