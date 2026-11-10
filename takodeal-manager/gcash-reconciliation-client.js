import {OWNER_EMAIL} from './workspace-access-model.js';
import {canonicalPaymentJSON,normalizeReconciliationSettings} from './payment-reconciliation-model.js';
export const GCASH_RECONCILIATION_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview/gcash-reconciliation';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value),exact=(value,keys)=>object(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const failure=()=>Object.assign(Error('Verification has not been confirmed. Reconnect and retry this exact preview to check its saved result.'),{code:'payment-reconciliation-unconfirmed'});
const matchEvidence=row=>({rowId:row.rowId,rowIndex:row.rowIndex,transactionId:row.transactionId,claimId:row.claimId,sourceFingerprint:row.sourceFingerprint});
export function reconciliationMappedRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>5000)throw failure();
 return rows.map((row,index)=>Object.fromEntries(['rowId','provider','merchantAlias','branch','transactionAt','status','kind','grossCents','grossAmount','reference','orderId','parseError'].flatMap(key=>{
  if(key==='rowId')return[[key,typeof row?.rowId==='string'&&row.rowId.trim()?row.rowId:String(index+1)]];
  if(key==='parseError')return row?.parseError?[[key,true]]:[];
  const value=row?.[key];return value===undefined?[]:[[key,value instanceof Date?value.toISOString():value]];
 })));
}
export function createGCashReconciliationMutations(api,{fetcher=globalThis.fetch,timeoutMs=25000,Controller=globalThis.AbortController}={}){
 if(!api||typeof fetcher!=='function'||typeof Controller!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>25000)throw failure();
 function capture(assertCurrent){
  const user=api.auth?.currentUser,session=api.sessionUser,signature=canonicalPaymentJSON([session?.uid,session?.email,session?.isOwner,session?.isFranchisee,session?.permissions,session?.allowedBranches]);
  const guard=()=>{assertCurrent();if(api.auth?.currentUser!==user||api.sessionUser!==session||!user?.uid||user.email?.toLowerCase()!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||session.email?.toLowerCase()!==OWNER_EMAIL||session.isOwner!==true||session.isFranchisee===true||canonicalPaymentJSON([session.uid,session.email,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches])!==signature)throw Error('The Owner account or workspace changed. Reopen this import preview.');};guard();return{user,guard};
 }
 async function send(path,body,{user,guard}){
  const controller=new Controller();let expired=false,timer;
  const check=()=>{guard();if(expired)throw failure();};
  const work=(async()=>{
   const token=await user.getIdToken();check();if(typeof token!=='string'||!token)throw failure();
   const url=GCASH_RECONCILIATION_ENDPOINT+path,response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),cache:'no-store',redirect:'error',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});check();
   if(response.redirected||response.type==='opaque'||response.type==='opaqueredirect'||response.url&&response.url!==url)throw failure();
   const result=await response.json();check();if(JSON.stringify(result).length>1048576)throw failure();
   if(!response.ok){if(response.status===403)throw Error('Your current Owner or branch access could not be confirmed. Saved verifications are kept.');if(response.status===409)throw Error('Receipt evidence or matching settings changed. Preview the file again; saved verifications are kept.');if(response.status===429)throw Error('Too many verification requests. Wait a minute and retry this exact preview. Saved verifications are kept.');throw failure();}
   return result;
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(failure());},timeoutMs);})]);}finally{clearTimeout(timer);controller.abort();}
 }
 return{
  async saveSettings(settings,{expectedRevision,assertCurrent=()=>{}}={}){
   const scope=capture(assertCurrent),desired=normalizeReconciliationSettings(settings),result=await send('/settings',{settings:desired,expectedRevision},scope);scope.guard();
   if(!exact(result,['schemaVersion','settings'])||result.schemaVersion!==1||canonicalPaymentJSON(normalizeReconciliationSettings(result.settings))!==canonicalPaymentJSON(desired))throw failure();return desired;
  },
  async verify({plan,rows,scope,automatic=false,assertCurrent=()=>{}}={}){
   const actor=capture(assertCurrent),mapped=reconciliationMappedRows(rows),candidates=automatic?plan.matches.filter(row=>row.automaticEligible===true):plan.matches,initialHeld=automatic?plan.matches.filter(row=>row.automaticEligible!==true).map(row=>({rowId:row.rowId,rowIndex:row.rowIndex,reason:'The saved receipt has no explicit matching payment reference. Review the evidence manually.'})):[],all=[...(plan.alreadyVerified||[]).map(row=>({row,prior:true})),...candidates.map(row=>({row,prior:false}))],results=[],held=[...initialHeld];
   for(let at=0;at<all.length;at+=25){
    actor.guard();const batch=all.slice(at,at+25),expected=new Map(batch.map(({row})=>[row.transactionId,row]));
    const result=await send('/verify',{fileSha256:plan.fileSha256,rows:mapped,scope:scope||null,settingsRevision:plan.settingsRevision,settingsFingerprint:plan.settingsFingerprint,matches:batch.filter(row=>!row.prior).map(({row})=>matchEvidence(row)),alreadyVerified:batch.filter(row=>row.prior).map(({row})=>matchEvidence(row)),automatic},actor);actor.guard();
    if(!exact(result,['schemaVersion','verified','alreadyVerified','results','held'])||result.schemaVersion!==1||!Array.isArray(result.results)||!Array.isArray(result.held)||!Number.isSafeInteger(result.verified)||result.verified<0||!Number.isSafeInteger(result.alreadyVerified)||result.alreadyVerified<0||result.results.length+result.held.length!==batch.length||result.verified+result.alreadyVerified!==result.results.length)throw failure();
    const seen=new Set();for(const row of result.results){const match=expected.get(row?.transactionId);if(!exact(row,['transactionId','claimId','alreadyVerified','fileSha256'])||!match||row.claimId!==match.claimId||!id(row.transactionId)||!hash(row.claimId)||!hash(row.fileSha256)||typeof row.alreadyVerified!=='boolean'||seen.has(row.transactionId))throw failure();seen.add(row.transactionId);results.push(row);}
    if(result.verified!==result.results.filter(row=>!row.alreadyVerified).length||result.alreadyVerified!==result.results.filter(row=>row.alreadyVerified).length)throw failure();
    for(const row of result.held){const match=batch.find(item=>item.row.rowId===row?.rowId&&item.row.rowIndex===row?.rowIndex)?.row;if(!exact(row,['rowId','rowIndex','reason'])||!match||seen.has(match.transactionId)||row.reason!=='The saved receipt has no explicit matching payment reference. Review the evidence manually.')throw failure();seen.add(match.transactionId);held.push(row);}
   }
   actor.guard();return{verified:results.filter(row=>!row.alreadyVerified).length,alreadyVerified:results.filter(row=>row.alreadyVerified).length,results,unresolved:[...plan.unresolved,...held]};
  }
 };
}
