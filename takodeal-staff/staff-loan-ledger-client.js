import {normalizeStaffLoanLedger} from './staff-loan-ledger-model.js';
import {resolvePrivatePhoneIdentity} from './private-phone-identity.js';
export const STAFF_LOAN_LEDGER_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/staff-loan-ledger';
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const device=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const messages={
 'loan-ledger-denied':'This phone is not approved to view your private loan records. Ask HQ to review its access.',
 'loan-ledger-review':'Your saved loan records need an HQ review. No balance has been estimated.',
 'loan-ledger-unavailable':'Your loan records could not be checked. Reconnect and try again.',
 'loan-ledger-timeout':'The loan check took too long. No balance was loaded. Check your connection and try again.',
 'loan-ledger-account-changed':'Your account or private view changed. Reopen My loans.',
 'loan-ledger-busy':'The earlier loan check is still finishing. Please wait before trying again.'
};
export const staffLoanLedgerError=code=>Object.assign(Error(messages[code]||messages['loan-ledger-unavailable']),{code:Object.hasOwn(messages,code)?code:'loan-ledger-unavailable'});
export function createStaffLoanLedgerClient({createPrivateClient,identity,deviceId,fetcher=globalThis.fetch,timeoutMs=20000,Controller=globalThis.AbortController,delay=setTimeout,cancelDelay=clearTimeout,onInvalidate=()=>{}}={}){
 if(typeof createPrivateClient!=='function'||typeof identity!=='function'||typeof deviceId!=='function'||typeof fetcher!=='function'||typeof Controller!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw staffLoanLedgerError('loan-ledger-unavailable');
 let generation=0,flight=null,controller=null,currentScope=null,unwatch=null;
 return{
  invalidate(){generation++;controller?.abort();currentScope=null;unwatch?.();unwatch=null;},
  isCurrent(){return !currentScope||identity()===currentScope.staffId&&deviceId()===currentScope.deviceId&&currentScope.auth.currentUser===currentScope.user;},
  async read({assertCurrent=()=>{}}={}){
   if(flight)throw staffLoanLedgerError('loan-ledger-busy');
   const staffId=identity(),selectedDevice=deviceId(),epoch=generation,requestController=new Controller();let expired=false,timer,client,user;
   if(!id(staffId)||!device(selectedDevice))throw staffLoanLedgerError('loan-ledger-denied');
   controller=requestController;
   const guard=()=>{
    if(expired)throw staffLoanLedgerError('loan-ledger-timeout');
    if(epoch!==generation||identity()!==staffId||deviceId()!==selectedDevice||user&&client.auth?.currentUser!==user)throw staffLoanLedgerError('loan-ledger-account-changed');
    assertCurrent();
   };
   const physical=Promise.resolve().then(async()=>{
    guard();client=await createPrivateClient({assertCurrent:guard});guard();user=client?.auth?.currentUser;
    if(!user?.uid||user.isAnonymous!==true||typeof user.getIdToken!=='function')throw staffLoanLedgerError('loan-ledger-denied');
    const privatePhone=await resolvePrivatePhoneIdentity({client,staffId,assertCurrent:guard});guard();
    currentScope={staffId,deviceId:selectedDevice,auth:client.auth,user};unwatch?.();
    unwatch=client.sdk?.onAuthStateChanged?.(client.auth,next=>{if(next!==user){generation++;requestController.abort();currentScope=null;onInvalidate();}})||null;
    const token=await user.getIdToken();guard();if(typeof token!=='string'||!token)throw staffLoanLedgerError('loan-ledger-denied');
    await privatePhone.assertFresh();guard();
    const response=await fetcher(STAFF_LOAN_LEDGER_ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({staffId,deviceId:privatePhone.deviceId}),cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:requestController.signal});guard();
    if(response.redirected||response.type==='opaque'||response.type==='opaqueredirect'||response.url&&response.url!==STAFF_LOAN_LEDGER_ENDPOINT)throw staffLoanLedgerError('loan-ledger-unavailable');
    const data=await response.json();guard();if(JSON.stringify(data).length>524288)throw staffLoanLedgerError('loan-ledger-unavailable');
    if(!response.ok){
     const denied=[401,403].includes(response.status),review=response.status===409||['loan-ledger-review','failed-precondition'].includes(data?.error?.code);
     throw staffLoanLedgerError(denied?'loan-ledger-denied':review?'loan-ledger-review':'loan-ledger-unavailable');
    }
    return normalizeStaffLoanLedger(data,{staffId});
   });
   flight=physical;const release=()=>{if(flight===physical){flight=null;if(controller===requestController)controller=null;}};physical.then(release,release);
   try{return await Promise.race([physical,new Promise((_,reject)=>{timer=delay(()=>{expired=true;requestController.abort();reject(staffLoanLedgerError('loan-ledger-timeout'));},timeoutMs);})]);}
   catch(error){guard();if(error?.code==='private-phone/denied')throw staffLoanLedgerError('loan-ledger-denied');if(error?.code==='private-phone/changed')throw staffLoanLedgerError('loan-ledger-account-changed');if(error?.code&&Object.hasOwn(messages,error.code))throw error;throw staffLoanLedgerError('loan-ledger-unavailable');}
   finally{cancelDelay(timer);requestController.abort();}
  }
 };
}
