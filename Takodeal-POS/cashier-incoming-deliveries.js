// The feed follows one selected workspace. It grants no new receiving authority
// and never changes a shipment, stock quantity, primary Auth or saved device.
import {CASHIER_OWNER_WORKSPACE} from './cashier-owner-workspace.js';
const branchValue=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=120;
const statuses=new Set(['In Transit','Arrived']);
const receiptFields=['id','toBranch','batchId','dispatchId','sourceBranch','fromBranch','sourceId','item','qty','uom','displayQty','displayUom','convRate','unitCost','franchiseCharged','supplyInvoiceVersion','franchiseSupplyOrderId'];
export const deliveryReceiptSource=row=>JSON.stringify(Object.fromEntries(receiptFields.filter(field=>row?.[field]!==undefined).map(field=>[field,row[field]])));
export function createIncomingDeliveryFormDrafts(d,{isReceiving=()=>false}={}){
 let scope=null,renderedRows=[],held=false;
 const dirty=()=>renderedRows.some(row=>String(d.getElementById('recv_val_'+row.id)?.value||'').length>0||d.getElementById('missing_check_'+row.id)?.checked===true||String(d.getElementById('remark_val_'+row.id)?.value||'').length>0);
 const signature=rows=>JSON.stringify(rows.map(row=>[deliveryReceiptSource(row),row.status,row.driver,row.date,row.time]).sort((a,b)=>a[0].localeCompare(b[0])));
 function preserve(state){
  if(scope!==state.scopeToken){scope=state.scopeToken;renderedRows=[];held=false;return false;}
  if(!dirty())return false;
  if(state.phase==='ready'&&signature(renderedRows)!==signature(state.rows))held=true;
  const blocked=held||state.phase!=='ready'||isReceiving();
  for(const row of renderedRows){const button=d.getElementById('btn_submit_dispatch_'+(row.batchId||row.dispatchId||`${row.date}_${row.driver}`));if(button)button.disabled=blocked;}
  if(held){const note=d.getElementById('incomingDeliveriesStatus');if(note)note.textContent='The shipment changed while you were counting. Your entries are kept on this screen. Use Refresh to review the changed shipment before receiving.';}
  return true;
 }
 return {preserve,rendered(state){scope=state.scopeToken;renderedRows=state.rows.map(row=>({...row}));held=false;},isHeld:()=>held,hasDraft:dirty,discard(){renderedRows=[];held=false;}};
}
export function createCashierIncomingDeliveries(w,{primaryAuth,primaryDb,subscribe=(query,next,error)=>w.onSnapshot(query,{includeMetadataChanges:true},next,error),onChange=()=>{},setInterval:every=globalThis.setInterval,clearInterval:clear=globalThis.clearInterval}={}){
 let generation=0,unsubscribe=null,context=null,monitor=null,stopped=false,scopeToken=0,scopeKey=null,current={phase:'signed-out',branch:'',rows:[],scopeToken:0,message:'Sign in to this branch to check incoming deliveries.'};
 const ids=new WeakMap();let nextId=0;const objectId=value=>{if(!value||typeof value!=='object')return null;if(!ids.has(value))ids.set(value,++nextId);return ids.get(value);};
 function capture(){
  const owner=w.getCashierOwnerWorkspaceContext?.();
  const session=w.sessionUser,branch=w.localStorage.getItem('takodeal_device_branch')||'',deviceId=w.localStorage.getItem('takodeal_device_id')||'';
  if(!session||typeof session.cashierName!=='string'||!session.cashierName.trim()||!branchValue(branch)||session.branch!==branch||!deviceId||session.cashierName==='User'&&session.branch==='Loading...')throw Error('Sign in to the Cashier app for this branch to check deliveries.');
  if(session.workspaceKind===CASHIER_OWNER_WORKSPACE&&!owner)throw Error('Reopen verified Owner Access before checking this branch’s deliveries.');
  const auth=owner?.auth||primaryAuth,db=owner?.db||primaryDb,user=auth?.currentUser||null;
  if(!db||owner&&(owner.session!==session||owner.branch!==branch||owner.user!==user))throw Error('The selected delivery workspace changed. Reopen this branch.');
  owner?.assertCurrent();
  const key=JSON.stringify([objectId(auth),objectId(db),objectId(user),objectId(session),session.staffId,session.email,session.isOwner,session.cashierName,session.branch,branch,deviceId]);
  const actionActor=owner?'Owner: '+String(owner.actionActor||owner.user.displayName||owner.user.email||'Verified Owner').replace(/^Owner:\s*/,''):session.cashierName;
  return {key,auth,db,user,session,branch,deviceId,owner:!!owner,prepareAction:owner?()=>owner.prepareAction():null,assertCurrent(){owner?.assertCurrent();if(w.sessionUser!==session||session.cashierName!==this.name||session.branch!==branch||w.localStorage.getItem('takodeal_device_branch')!==branch||w.localStorage.getItem('takodeal_device_id')!==deviceId||auth?.currentUser!==user)throw Error('The signed-in workspace or delivery branch changed. Refresh this branch before receiving.');},name:session.cashierName,actionActor};
 }
 const signed=()=>{try{const s=w.sessionUser;return !!s&&typeof s.cashierName==='string'&&!!s.cashierName.trim()&&branchValue(s.branch)&&s.branch===w.localStorage.getItem('takodeal_device_branch');}catch{return false;}};
 function publish(next){current={...next,scopeToken};w.incomingDeliveriesList=next.rows;w.incomingDeliveriesState={phase:next.phase,branch:next.branch,message:next.message};onChange({...current,rows:[...next.rows]});}
 function disconnect(){generation++;unsubscribe?.();unsubscribe=null;context=null;}
 function same(c,run){try{c.assertCurrent();return !stopped&&run===generation&&capture().key===c.key;}catch{return false;}}
 function start({force=false}={}){
  stopped=false;let selected;try{selected=capture();}catch(error){disconnect();if(scopeKey!==null){scopeToken++;scopeKey=null;}publish({phase:signed()?'error':'signed-out',branch:signed()?w.sessionUser.branch:'',rows:[],message:error.message});return false;}
  if(!force&&context?.key===selected.key&&unsubscribe)return true;
  disconnect();if(scopeKey!==selected.key){scopeToken++;scopeKey=selected.key;}context=selected;const run=generation;
  publish({phase:'loading',branch:selected.branch,rows:[],message:'Checking incoming deliveries for '+selected.branch+'…'});
  try{
   if(typeof subscribe!=='function')throw Error('The delivery connection is unavailable. Refresh the app files and retry.');
   const query=w.query(w.collection(selected.db,'dispatch_logs'),w.where('toBranch','==',selected.branch),w.where('status','in',['In Transit','Arrived']));
   const stop=subscribe(query,snapshot=>{
    if(!same(selected,run))return;
    try{
     const documents=Array.isArray(snapshot?.docs)?snapshot.docs:(()=>{const found=[];snapshot?.forEach?.(row=>found.push(row));return found;})();
     if(!snapshot||!Array.isArray(snapshot.docs)&&typeof snapshot.forEach!=='function')throw Error('HQ returned an incomplete delivery list. Refresh this branch.');
     const rows=documents.map(document=>{const row=document.data();if(typeof document.id!=='string'||!document.id||!row||row.toBranch!==selected.branch||!statuses.has(row.status))throw Error('A delivery response belongs to another branch or status. Refresh this branch.');return {...row,id:document.id};});
     const cached=snapshot.metadata?.fromCache===true||snapshot.metadata?.hasPendingWrites===true||documents.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites);
     publish({phase:cached?'cached':'ready',branch:selected.branch,rows,message:cached?'Saved delivery list for '+selected.branch+'. Reconnect before confirming receipt.':rows.length?rows.length+' incoming delivery item'+(rows.length===1?'':'s')+' for '+selected.branch+'. No open register is required.':'No incoming deliveries for '+selected.branch+'. Use Refresh to check HQ again.'});
    }catch(error){publish({phase:'error',branch:selected.branch,rows:[],message:error.message});}
   },error=>{if(same(selected,run))publish({phase:'error',branch:selected.branch,rows:[],message:'Incoming deliveries could not be confirmed for '+selected.branch+'. Check the connection or account, then use Refresh. '+String(error?.message||'')});});
   if(typeof stop!=='function')throw Error('The delivery connection did not start. Refresh this branch.');
   if(same(selected,run))unsubscribe=stop;else stop();
  }catch(error){if(same(selected,run))publish({phase:'error',branch:selected.branch,rows:[],message:error.message});}
  return true;
 }
 function tick(){if(stopped)return;let next;try{next=capture();}catch{if(context||current.phase!=='signed-out'&&current.phase!=='error')start();return;}if(next.key!==context?.key)start();}
 function ensureMonitor(){if(monitor===null&&typeof every==='function'){monitor=every(tick,1000);monitor?.unref?.();}}
 function stop(){stopped=true;disconnect();if(scopeKey!==null){scopeToken++;scopeKey=null;}if(monitor!==null)clear(monitor);monitor=null;publish({phase:'signed-out',branch:'',rows:[],message:'Sign in to this branch to check incoming deliveries.'});}
 function receiveContext(itemIds,{expectedRows}={}){
  if(current.phase!=='ready')throw Error('Refresh incoming deliveries with HQ before confirming a receipt.');
  const c=capture();c.assertCurrent();if(c.key!==context?.key||current.branch!==c.branch)throw Error('The delivery workspace changed. Refresh this branch.');
  if(!Array.isArray(itemIds)||!itemIds.length||new Set(itemIds).size!==itemIds.length||itemIds.some(id=>!current.rows.some(row=>row.id===id&&row.toBranch===c.branch&&row.status==='Arrived')))throw Error('This shipment is not currently Arrived in the selected branch. Refresh before receiving.');
  const sources=new Map(itemIds.map(id=>{const row=current.rows.find(row=>row.id===id),expected=expectedRows?.find(row=>row.id===id)||row;if(deliveryReceiptSource(row)!==deliveryReceiptSource(expected))throw Error('The saved shipment quantities or units changed. Refresh and review the physical counts again.');return[id,deliveryReceiptSource(expected)];}));
  const guard=()=>{c.assertCurrent();if(capture().key!==c.key)throw Error('The delivery workspace changed. Refresh before receiving.');};
  const savedSource=(reference,snapshot)=>{const id=reference.id;if(reference.path?.startsWith('dispatch_logs/')&&sources.has(id)&&snapshot.exists()&&deliveryReceiptSource({...snapshot.data(),id})!==sources.get(id))throw Error('The saved shipment quantities or units changed. Refresh and review before receiving.');};
  const api=Object.create(w);Object.defineProperties(api,{db:{value:c.db},auth:{value:c.auth}});
  for(const method of ['getDocFromServer','getDocsFromServer'])Object.defineProperty(api,method,{value:async reference=>{guard();const value=await w[method](reference);guard();if(method==='getDocFromServer')savedSource(reference,value);return value;}});
  Object.defineProperty(api,'runTransaction',{value:async(db,work)=>{guard();const authority=c.owner?await c.prepareAction():null;guard();if(c.owner&&typeof authority?.checkTransaction!=='function')throw Error('Reopen verified Owner Access before receiving this shipment.');return w.runTransaction(db,async transaction=>{guard();if(authority)await authority.checkTransaction(transaction);guard();const tx={get:async reference=>{guard();const value=await transaction.get(reference);guard();savedSource(reference,value);return value;},set:(...args)=>{guard();return transaction.set(...args);},update:(...args)=>{guard();return transaction.update(...args);}};const result=await work(tx);guard();return result;});}});
  return {api,branch:c.branch,actor:c.actionActor,assertCurrent:guard};
 }
 const result={start(options){ensureMonitor();return start(options);},refresh(){ensureMonitor();return start({force:true});},stop,check:tick,state:()=>({...current,rows:[...current.rows]}),isAvailable:()=>current.phase!=='signed-out',receiveContext};
 w.addEventListener?.('storage',event=>{if(['takodeal_device_branch','takodeal_device_id'].includes(event.key))tick();});
 w.addEventListener?.('cashier-workspace-changed',tick);return result;
}
