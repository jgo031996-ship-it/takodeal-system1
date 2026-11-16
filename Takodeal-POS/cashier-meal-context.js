import {bindCashierOperationalSdk} from './cashier-operational-sdk.js';
import {createSaleEngine} from './pos-safety.js';
const changed=()=>Error('The cashier, working branch or tablet changed. Reopen this meal checkout.');
const sessionKey=s=>JSON.stringify([s?.staffId??s?.id??null,s?.cashierName,s?.branch,s?.pin??null]);
// Reuse the existing matching Cashier Auth/Firestore pair. No sign-in, new PIN,
// device approval, home-branch transfer or private access is created here.
export function createCashierMealContext(w,{primaryAuth,deviceContext}={}){
 const physical=()=>JSON.stringify([w.localStorage.getItem('takodeal_device_branch'),w.localStorage.getItem('takodeal_device_id')]);
 async function resolve({assertCurrent=()=>{},captureSession=true,payload}={}){
  const location=physical(),branch=w.localStorage.getItem('takodeal_device_branch'),primaryUser=primaryAuth?.currentUser,session=w.sessionUser,key=sessionKey(session);
  const current=()=>{assertCurrent();if(physical()!==location||primaryAuth?.currentUser!==primaryUser||captureSession&&(w.sessionUser!==session||sessionKey(w.sessionUser)!==key))throw changed();};current();
  if(!branch||captureSession&&session?.branch!==branch||payload&&payload.branch!==branch)throw changed();
  const context=await deviceContext.resolve({assertCurrent:current});current();
  const auth=context?.auth,db=context?.deviceApi?.db,user=auth?.currentUser;
  if(!user?.uid||user.isAnonymous!==true||!auth.app||db?.app!==auth.app)throw Error('Reconnect this tablet’s existing Cashier account. Your PIN, cart and saved receipts are kept.');
  const guard=()=>{current();if(auth.currentUser!==user||auth.app!==db.app)throw changed();};guard();
  const base={...w,...context.deviceApi,db,auth},api={...base,...bindCashierOperationalSdk(base,guard)};
  return api;
 }
 return {read:options=>resolve(options),sale:payload=>resolve({captureSession:false,payload})};
}
// Only company-meal receipts use this connection. All accounting and inventory
// operations remain the existing sale engine, with the same receipt/outbox IDs.
export function createMealScopedSaleEngine(api){
 const ordinary=createSaleEngine(api),wrapped={...ordinary};
 for(const method of ['alreadyCommitted','prepare','commit'])wrapped[method]=async(payload,...args)=>{
  if(!payload?.mealStaffName||typeof api.resolveMealApi!=='function')return ordinary[method](payload,...args);
  return createSaleEngine(await api.resolveMealApi(payload))[method](payload,...args);
 };
 return wrapped;
}
