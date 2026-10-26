export const CASH_REMITTANCE_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/cashRemittanceReview';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const canonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(name=>[name,item[name]])):item);
const clock=()=>globalThis.performance?.now?.()??Date.now();
const unknown='HQ has not confirmed this review. Refresh the saved status or retry the same review; do not record another cash receipt.';
export function cashInputCents(value,{positive=false}={}){
 const text=String(value??'').trim();if(!/^\d{1,10}(?:\.\d{1,2})?$/.test(text))throw Error('Enter a valid peso amount with no more than 2 decimal places.');
 const [whole,fraction='']=text.split('.'),cents=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||cents>100000000000||positive&&cents<=0)throw Error('Enter a positive cash amount within the supported limit.');return cents;
}
const decimal=cents=>(cents/100).toFixed(2);
export function ownerCashIdentity(api){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!key(user?.uid)||user.email?.toLowerCase()!=='jgo031996@gmail.com'||user.emailVerified!==true||session?.isOwner!==true||session.uid!==user.uid||session.email?.toLowerCase()!==user.email.toLowerCase()||session.isFranchisee)throw Error('Sign in and unlock the verified Owner account before reviewing cash.');
 return canonical([user.uid,user.email,session.uid,session.email,session.isOwner,session.isFranchisee??false]);
}
function checkedRow(row,id){
 if(!object(row)||row.id!==id||!key(id)||typeof row.branch!=='string'||!row.branch.trim()||!['Pending','Received','Rejected','Approved'].includes(row.status)||!Number.isInteger(row.reviewVersion??1)||(row.reviewVersion??1)<1)throw Error('The saved remittance could not be confirmed. Refresh its history.');
 cashInputCents(row.amount,{positive:true});
 if(row.remittanceVersion===4){const count=row.reconciliation;if(!object(count)||!['expectedBeforeCents','sentCents','expectedRemainingCents','countedRemainingCents','countedBeforeCents','varianceCents'].every(name=>Number.isSafeInteger(count[name]))||count.sentCents!==cashInputCents(row.amount)||count.expectedBeforeCents-count.sentCents!==count.expectedRemainingCents||count.countedRemainingCents+count.sentCents!==count.countedBeforeCents||count.countedBeforeCents-count.expectedBeforeCents!==count.varianceCents||count.countedRemainingCents<0||count.sentCents<=0||count.countConfirmed!==true)throw Error('The saved physical cash count is incomplete. Ask HQ to review this remittance before receiving it.');}
 if(row.receipt){const receipt=row.receipt;if(receipt.version!==1||receipt.countConfirmed!==true||!Number.isSafeInteger(receipt.receivedCents)||receipt.receivedCents<=0||receipt.declaredSentCents!==cashInputCents(row.amount)||receipt.varianceCents!==receipt.receivedCents-receipt.declaredSentCents||!key(receipt.operationId)||!key(receipt.targetAccountId)||receipt.receivedByEmail?.toLowerCase()!=='jgo031996@gmail.com'||typeof receipt.confirmedAt!=='string'||!Number.isFinite(Date.parse(receipt.confirmedAt)))throw Error('The saved cash receipt could not be confirmed. Refresh its review.');}
 if(row.remittanceVersion===4&&row.status==='Received'&&!row.receipt)throw Error('The saved cash receipt is missing its confirmed count. Ask HQ to review it.');
 return row;
}
export function createOwnerCashRemittanceClient(api,{fetch=globalThis.fetch,storage=api.localStorage,makeId=()=>globalThis.crypto.randomUUID(),timeoutMs=45000}={}){
 const flights=new Map();
 const guard=identity=>{if(ownerCashIdentity(api)!==identity)throw Error('The Owner account changed. Reopen this cash review.');};
 const storageKey=(identity,id)=>'takodeal_owner_remittance_review_v1:'+encodeURIComponent(identity)+':'+encodeURIComponent(id);
 function readPending(id){const identity=ownerCashIdentity(api);const raw=storage?.getItem(storageKey(identity,id));if(!raw)return null;let saved;try{saved=JSON.parse(raw);}catch{throw Error('The saved cash review needs checking. Do not record another receipt.');}if(!key(saved?.operationId)||!object(saved.body)||saved.body.id!==id||saved.body.operationId!==saved.operationId||!['/receive','/reject'].includes(saved.route)||saved.fingerprint!==canonical({route:saved.route,body:saved.body}))throw Error('The saved cash review needs checking. Do not record another receipt.');return saved;}
 function prepare(route,body,identity){
  if(!storage?.getItem||!storage?.setItem||!storage?.removeItem)throw Error('Device storage is unavailable. Keep this review open; a safe receipt number cannot be preserved.');
  const previous=readPending(body.id),intent=canonical({route,body});if(previous){const old={...previous.body};delete old.operationId;if(previous.route!==route||canonical({route,body:old})!==intent)throw Error('An earlier cash review is awaiting confirmation. Retry its original details or refresh the saved decision before changing it.');return previous;}
  const operationId=makeId();if(!key(operationId))throw Error('A secure review number could not be created. Reopen this cash review.');
  const saved={route,body:{...body,operationId}};saved.operationId=operationId;saved.fingerprint=canonical({route,body:saved.body});storage.setItem(storageKey(identity,body.id),JSON.stringify(saved));
  if(storage.getItem(storageKey(identity,body.id))!==JSON.stringify(saved))throw Error('The review number was not preserved. No cash receipt was sent.');return saved;
 }
 async function exchange(route,body,identity,{mutation=false,budget=timeoutMs}={}){
  const controller=new AbortController();let timer,expired=false,sent=false;
  const check=()=>{guard(identity);if(expired)throw Error(unknown);};
  const work=(async()=>{check();const user=api.auth.currentUser,token=await user.getIdToken();check();if(api.auth.currentUser!==user||typeof token!=='string'||token.length<20)throw Error('Sign in to verify the Owner account again.');
   sent=true;const response=await fetch(CASH_REMITTANCE_ENDPOINT+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal,redirect:'error',cache:'no-store',credentials:'omit'});check();const result=await response.json();check();
   if(!response.ok){const error=Error(typeof result?.message==='string'?result.message.slice(0,500):typeof result?.error?.message==='string'?result.error.message.slice(0,500):unknown);error.status=response.status;error.code=result?.code??result?.error?.code;throw error;}
   if(!object(result))throw Error(unknown);return result;
  })();
  try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(Error(unknown));},Math.max(1,budget));})]);}
  catch(error){if(mutation&&!sent){error.cashReviewNotSent=true;}throw error;}
  finally{clearTimeout(timer);}
 }
 async function audit(id,{deadlineAt}={}){const identity=ownerCashIdentity(api);if(!key(id))throw Error('Choose a saved remittance.');if(deadlineAt!==undefined&&clock()>=deadlineAt)throw Error(unknown);const result=await exchange('/audit',{id},identity,{budget:deadlineAt===undefined?timeoutMs:deadlineAt-clock()});guard(identity);checkedRow(result.row,id);
  if(!Array.isArray(result.eligibleAccounts??[])||(result.eligibleAccounts??[]).some(account=>!key(account.id)||typeof account.name!=='string'||account.branch!=='Main Office'))throw Error('HQ cash accounts could not be confirmed. Refresh this cash review.');
  const prior=readPending(id);if(prior&&result.row.status!=='Pending')storage.removeItem(storageKey(identity,id));
  return {...result,history:Array.isArray(result.history)?result.history:[],eligibleAccounts:result.eligibleAccounts??[],legacy:result.row.remittanceVersion!==4};
 }
 async function drawer(branch){const identity=ownerCashIdentity(api);if(typeof branch!=='string'||!branch.trim()||branch.length>120)throw Error('Choose a saved branch before checking drawer cash.');const result=await exchange('/drawer',{branch:branch.trim()},identity);guard(identity);const snapshot=result.snapshot,shift=result.sourceShift;if(result.branch!==branch.trim()||!object(snapshot)||snapshot.version!==1||snapshot.branch!==result.branch||!key(snapshot.sourceShiftId)||!Number.isSafeInteger(snapshot.expectedBeforeCents)||Math.abs(snapshot.expectedBeforeCents)>1000000000000||!object(shift)||shift.id!==snapshot.sourceShiftId||shift.branch!==result.branch||typeof snapshot.active!=='boolean'||shift.active!==snapshot.active)throw Error('The saved branch drawer could not be confirmed. Refresh its cash review.');return result;}
 function decide(route,input){
  const identity=ownerCashIdentity(api),id=input?.id;if(!key(id)||!Number.isInteger(input.expectedVersion)||input.expectedVersion<1)throw Error('Refresh this saved remittance before deciding.');
  const note=String(input.note??'').trim();if(note.length>1500)throw Error('Keep the review note within 1,500 characters.');
  let body={id,expectedVersion:input.expectedVersion,note};
  if(route==='/receive'){const receivedCents=cashInputCents(input.receivedAmount,{positive:true});if(input.confirmCount!==true||typeof input.legacyAcknowledged!=='boolean'||!key(input.targetAccountId))throw Error('Count the cash received, confirm the count and choose its HQ account.');body={...body,receivedAmount:decimal(receivedCents),confirmCount:true,legacyAcknowledged:input.legacyAcknowledged,targetAccountId:input.targetAccountId};}
  else if(note.length<8)throw Error('Add a review note of at least 8 characters.');
  const flightKey=canonical([identity,id]),intent=canonical({route,body});const existing=flights.get(flightKey);if(existing){if(existing.intent!==intent)throw Error('The earlier cash review is still awaiting confirmation.');return existing.promise;}
  const saved=prepare(route,body,identity),deadlineAt=clock()+timeoutMs;
  const promise=(async()=>{let result;try{result=await exchange(route,saved.body,identity,{mutation:true,budget:deadlineAt-clock()});}catch(error){if(error.cashReviewNotSent)storage.removeItem(storageKey(identity,id));throw error;}guard(identity);
   const row=checkedRow(result.row,id);if(typeof result.alreadySaved!=='boolean'||row.status!==(route==='/receive'?'Received':'Rejected')||(row.reviewVersion??1)<=input.expectedVersion)throw Error(unknown);
   if(route==='/receive'){const receipt=row.receipt;if(!object(receipt)||receipt.version!==1||receipt.countConfirmed!==true||!Number.isSafeInteger(receipt.receivedCents)||receipt.receivedCents<=0||receipt.receivedCents!==cashInputCents(saved.body.receivedAmount)||receipt.operationId!==saved.operationId||receipt.targetAccountId!==saved.body.targetAccountId||receipt.receivedByEmail?.toLowerCase()!=='jgo031996@gmail.com'||typeof receipt.confirmedAt!=='string'||!Number.isFinite(Date.parse(receipt.confirmedAt)))throw Error(unknown);}
   else if(row.review?.operationId!==saved.operationId||row.review?.reviewedByEmail?.toLowerCase()!=='jgo031996@gmail.com')throw Error(unknown);
   const confirmed=await audit(id,{deadlineAt});guard(identity);if(confirmed.row.status!==row.status||(confirmed.row.reviewVersion??1)!==(row.reviewVersion??1)||canonical(route==='/receive'?confirmed.row.receipt:confirmed.row.review)!==canonical(route==='/receive'?row.receipt:row.review))throw Error(unknown);
   storage.removeItem(storageKey(identity,id));return {...result,row:confirmed.row};
  })();const entry={intent,promise};flights.set(flightKey,entry);promise.finally(()=>{if(flights.get(flightKey)===entry)flights.delete(flightKey);}).catch(()=>{});return promise;
 }
 return {audit,drawer,receive:input=>decide('/receive',input),reject:input=>decide('/reject',input),pending:readPending,assertOwner:()=>ownerCashIdentity(api)};
}
