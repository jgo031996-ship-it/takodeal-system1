import {beginCashierOwnerPreview,cashierStartupBusy,refreshCashierBranchLabel} from './cashier-startup.js';
import {isCashierOwnerActionUser} from './cashier-protected-action.js';

export const CASHIER_OWNER_WORKSPACE='verified-owner-workspace-v1';
const OWNER='jgo031996@gmail.com',OWNER_APP='takodeal-pos-owner-preview-v1';
const inactiveStatuses=new Set(['closed','resigned','terminated','inactive','disabled','revoked','archived','blocked','deleted','offboarded','offboard','finished contract','contract ended','end of contract']);
const inactive=row=>!row||row.active===false||row.isActive===false||['archived','isArchived','deleted','isDeleted','blocked','revoked','offboarded','resigned','terminated','disabled'].some(key=>row[key]===true)||[row.status,row.employmentStatus].some(value=>inactiveStatuses.has(String(value||'').trim().toLowerCase()))||['resigned','terminated','revoked','offboarded'].includes(String(row.contractStatus||'').trim().toLowerCase())||[row.pin,row.securityPin].some(value=>/^(REVOKED|BLOCKED)$/i.test(String(value??'').trim()));
const branch=value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=120&&!/^all$/i.test(value)&&!/[\u0000-\u001f\u007f]/.test(value);
const error=()=>Error('The Owner workspace or selected branch changed. Reopen Owner Access before continuing.');
const contents=value=>JSON.stringify(value);

// A RAM-only view context. It never replaces Firebase Auth/Firestore, a Staff
// login, an offline queue, or the identity captured by the receipt engines.
export function createCashierOwnerWorkspace(w,d,{primaryAuth,primaryDb,firebaseConfig,resolveOwner,timeoutMs=20000}={}){
 let state=null,flight=null,epoch=0;
 const emit=()=>{if(typeof w.dispatchEvent==='function'&&typeof w.Event==='function')w.dispatchEvent(new w.Event('cashier-workspace-changed'));};
 const exactApp=app=>app&&app.name===OWNER_APP&&['projectId','appId','apiKey','authDomain'].every(key=>typeof firebaseConfig?.[key]==='string'&&app.options?.[key]===firebaseConfig[key])&&firebaseConfig.projectId==='takodeal-pos';
 // Trusted construction seam for credential-free SDK tests. Production uses
 // the strict fixed named-app verifier, never a local Owner display flag.
 const resolveAccount=resolveOwner||async function({auth,db,user,assertCurrent}){
  if(!exactApp(auth?.app)||db?.app!==auth.app||typeof user?.getIdTokenResult!=='function')throw Error('Use the verified Google Owner account in this Cashier app before opening a branch.');
  const uid=user.uid,credentialCurrent=()=>{if(auth.currentUser!==user||user.uid!==uid||!isCashierOwnerActionUser(user)||!exactApp(auth.app)||db.app!==auth.app)throw error();};
  assertCurrent();credentialCurrent();const result=await user.getIdTokenResult(true);assertCurrent();credentialCurrent();const claims=result?.claims;
  if(claims?.sub!==uid||String(claims.email||'').toLowerCase()!==OWNER||claims.email_verified!==true||claims.firebase?.sign_in_provider!=='google.com')throw Error('Use the verified Google Owner account before opening a branch.');
  return{auth,db,user,current:credentialCurrent};
 };
 async function account(input){const result=await resolveAccount(input);input.assertCurrent();if(result?.auth!==input.auth||result.db!==input.db||result.user!==input.user||typeof result.current!=='function')throw error();result.current();return result;}
 function validateAuthority({owners,branches,devices},user,selectedBranch,deviceId){
  const owner=owners[0],target=branches[0];
  if(owners.length!==1||owner.email?.trim().toLowerCase()!==OWNER||owner.uid!=null&&owner.uid!==''&&owner.uid!==user.uid||inactive(owner)||String(owner.role||'').trim().toLowerCase()!=='owner')throw Error('The saved Owner account is inactive or needs review.');
  if(branches.length!==1||target.name!==selectedBranch||inactive(target))throw Error('This branch is inactive or needs review. Choose an active branch.');
  if(devices.some(row=>row.deviceId!==deviceId||inactive(row)))throw Error('This device has an inactive registration. Ask the Owner to review Device Fleet before opening this workspace.');
 }
 async function authority({db,user,branch:selectedBranch,deviceId},assertCurrent){
  const read=async(table,field,value,cap)=>{
   assertCurrent();const snap=await w.getDocsFromServer(w.query(w.collection(db,table),w.where(field,'==',value),w.limit(cap)));assertCurrent();
   if(!Array.isArray(snap?.docs)||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||snap.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites)||snap.docs.length>=cap)throw Error('Reconnect to confirm the current Owner account and selected branch.');
   return snap.docs.map(row=>({...row.data(),id:row.id}));
  };
  const [owners,branches,devices]=await Promise.all([read('hq_managers','email',OWNER,2),read('branches','name',selectedBranch,2),read('pos_devices','deviceId',deviceId,3)]),rows={owners,branches,devices};assertCurrent();validateAuthority(rows,user,selectedBranch,deviceId);
  // The exact known source docs are read again inside a stock-receive TX.
  // A Web transaction cannot lock future duplicate query results; uniqueness
  // is freshly checked above rather than claimed as a Rules-level guarantee.
  const refs=Object.entries({hq_managers:owners,branches, pos_devices:devices}).flatMap(([table,list])=>list.map(row=>({table,id:row.id})));
  return {async checkTransaction(tx){
   assertCurrent();const currentRows={owners:[],branches:[],devices:[]},keys={hq_managers:'owners',branches:'branches',pos_devices:'devices'};
   await Promise.all(refs.map(async({table,id})=>{const snap=await tx.get(w.doc(db,table,id));assertCurrent();if(!snap.exists())throw error();currentRows[keys[table]].push({...snap.data(),id});}));
   assertCurrent();validateAuthority(currentRows,user,selectedBranch,deviceId);
  }};
 }
 function current(){
  if(!state)return null;const value=state;
  const assertCurrent=()=>{
   value.accountCurrent();if(state!==value||epoch!==value.epoch||primaryAuth?.currentUser!==value.primaryUser||w.db!==primaryDb||value.auth.currentUser!==value.user||value.user.uid!==value.session.uid||!isCashierOwnerActionUser(value.user)||value.db?.app!==value.auth.app||w.sessionUser!==value.session||w.localStorage.getItem('takodeal_device_id')!==value.deviceId||w.localStorage.getItem('takodeal_device_branch')!==value.branch)throw error();
  };
  const prepareAction=async()=>{assertCurrent();await account({auth:value.auth,db:value.db,user:value.user,assertCurrent});assertCurrent();return authority(value,assertCurrent);};
  assertCurrent();return {auth:value.auth,db:value.db,user:value.user,session:value.session,branch:value.branch,actionActor:value.actionActor,assertCurrent,prepareAction};
 }
 const isToolsMode=()=>Boolean(state||w.sessionUser?.workspaceKind===CASHIER_OWNER_WORKSPACE);
 const notice=()=>{w.Swal?.fire?.('Staff sign-in needed','Owner Access is for branch inspection, printer settings and receiving deliveries. Sign out and use a Staff PIN before sales, register or staff actions.','info');return false;};
 function clear(){if(w.cashierDispatchReceiving===true){w.Swal?.fire?.('Delivery still being checked','Wait for this delivery receipt to finish before signing out. Keep its saved reference if the connection is interrupted.','info');return false;}epoch++;state=null;if(w.sessionUser?.workspaceKind===CASHIER_OWNER_WORKSPACE)w.sessionUser=null;emit();return true;}
 function installStaffActionGuards(){
  // New/unpaid UI actions only. Existing paid queues retain their captured
  // engine/database and may finish uploading under the original identity.
  for(const name of ['openCheckoutModal','submitFinalOrder','processCheckout','openShiftModal','submitOpenShift','openNewShift','MASTER_CloseShift','submitComprehensiveCloseShift','safeSubmitComprehensiveCloseShift','closeShift','openTimeClockModal','confirmPrepCart','voidTransaction','authorizeMealPin','toggleAuditMode','parkOrder','parkOrderToDB','resumeOrder','discardParkedOrder','deleteParkedOrder','deleteParkedOrderManually','submitInventoryCheck','submitBranchExpense']){
   const original=w[name];if(typeof original!=='function')continue;
   w[name]=function(...args){if(isToolsMode())return notice();return original.apply(this,args);};
  }
 }
 async function enter({auth,db,user,branch:selectedBranch}={}){
  if(flight)throw Error('Owner Access is still checking this branch. Keep the current screen and wait for its result.');
  if(state||w.cashierDispatchReceiving===true||cashierStartupBusy(w))throw Error('Finish or park the order and sign out before opening Owner Access. Keep pending cash handovers on this tablet.');
  const token=++epoch,session=w.sessionUser,primaryUser=primaryAuth?.currentUser,deviceId=w.localStorage.getItem('takodeal_device_id'),oldBranch=w.localStorage.getItem('takodeal_device_branch'),cart=w.cart,carts=w.platformCarts,entries=Object.entries(carts||{}),cartContents=contents(cart),cacheContents=contents(carts);let retired=false,timer;
  const assertCurrent=()=>{
   if(retired||epoch!==token||primaryAuth?.currentUser!==primaryUser||w.db!==primaryDb||w.sessionUser!==session||w.localStorage.getItem('takodeal_device_id')!==deviceId||w.localStorage.getItem('takodeal_device_branch')!==oldBranch||w.cart!==cart||w.platformCarts!==carts||entries.some(([key,value])=>w.platformCarts?.[key]!==value)||contents(w.cart)!==cartContents||contents(w.platformCarts)!==cacheContents||w.cashierDispatchReceiving===true||cashierStartupBusy(w)||auth?.currentUser!==user||!isCashierOwnerActionUser(user))throw error();
  };
  const work=(async()=>{
   if(!branch(selectedBranch))throw Error('Choose an active branch before opening Owner Access.');
   const verified=await account({auth,db,user,assertCurrent});
   await authority({db,user,branch:selectedBranch,deviceId},assertCurrent);assertCurrent();
   // Owner inspection/local tools do not request or create device approval.
   // An existing revoked registration remains a hold, even for this view.
   const displayName=typeof user.displayName==='string'&&user.displayName.trim()?user.displayName.trim().slice(0,120):OWNER;
   const operational=Object.freeze({uid:user.uid,email:OWNER,displayName,cashierName:'Owner (System Test)',branch:selectedBranch,role:'Owner',isOwner:true,workspaceKind:CASHIER_OWNER_WORKSPACE});
   assertCurrent();beginCashierOwnerPreview(w,selectedBranch);w.localStorage.setItem('cashierName',operational.cashierName);
   if(w.localStorage.getItem('takodeal_device_branch')!==selectedBranch||w.localStorage.getItem('cashierName')!==operational.cashierName)throw Error('Owner Access could not save the selected branch. Keep this tablet’s saved data and retry.');
   w.sessionUser=operational;
   state={epoch:token,auth,db,user,session:operational,primaryUser,branch:selectedBranch,deviceId,actionActor:'Owner: '+displayName,accountCurrent:verified.current};
   const context=current();
   refreshCashierBranchLabel(w,d);
   const branchLabel=d.getElementById('displayBranchText')||d.getElementById('displayBranch'),cashierLabel=d.getElementById('displayCashierText')||d.getElementById('displayCashier');
   if(branchLabel)branchLabel.textContent=selectedBranch;if(cashierLabel)cashierLabel.textContent='Owner · '+displayName;
   for(const id of ['loginOverlay','pinOverlay','ownerAccessBtnContainer']){const node=d.getElementById(id);if(node)node.style.display='none';}
   emit();return context;
  })();
  flight=work;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{retired=true;reject(Error('Owner Access could not confirm this branch yet. Keep saved orders and retry when connected.'));},timeoutMs);})]);}
  finally{clearTimeout(timer);work.finally(()=>{if(flight===work)flight=null;}).catch(()=>{});}
 }
 return {enter,current,clear,isToolsMode,installStaffActionGuards};
}
