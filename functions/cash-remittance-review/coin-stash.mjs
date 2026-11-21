import {createHash} from 'node:crypto';
import {activeAccessStaff,accessDevice,accessId,isAccessOwner} from './access-model.mjs';

const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const key=value=>typeof value==='string'&&value.length>0&&value.length<=150&&!/[\/\\\x00-\x1f]/.test(value)&&value!=='.'&&value!=='..';
const hash=value=>createHash('sha256').update(value).digest('hex');
const cash=value=>{if(typeof value==='string'&&/^[+-]?\d+(?:\.\d{1,2})?$/.test(value.trim()))value=Number(value);const result=Math.round(Number(value)*100);if(typeof value!=='number'||!Number.isSafeInteger(result)||Math.abs(value*100-result)>0.00001)fail(409,'The saved stash balance needs review.');return result;};
const row=snapshot=>snapshot.exists?snapshot.data():null;
const noteText=value=>typeof value==='string'&&value.length<=240&&!/[\x00-\x08\x0b-\x1f]/.test(value);
export async function cashierIdentity(db,tx,actor,body,now){
 const get=async path=>row(await tx.get(db.doc(path))),deny=()=>fail(403,'Sign in again on the approved branch station.');
 if(!key(actor.uid)||!accessDevice(body.deviceId)||!key(body.shiftId)||!accessId(body.sessionId))deny();
 const session=await get('staff_login_sessions/'+actor.uid);
 if(session?.schemaVersion!==1||session.uid!==actor.uid||session.app!=='cashier'||session.branch!==body.branch||session.sessionId!==body.sessionId||session.deviceId!==body.deviceId||!accessId(session.staffId)||!(new Date(session.expiresAt?.toDate?.()??session.expiresAt).getTime()>now))deny();
 const profile=await tx.get(db.doc('cashiers/'+session.staffId));
 if(!profile.exists||!activeAccessStaff(profile.data())||session.profileRevision!==profile.updateTime.seconds+'|'+profile.updateTime.nanoseconds)deny();
 if(actor.firebase?.sign_in_provider==='anonymous'){
  const binding=await get('pos_bindings/'+actor.uid);
  if(binding?.uid!==actor.uid||binding.status!=='Active'||binding.deviceId!==body.deviceId||binding.branch!==body.branch||!accessId(binding.legacyDeviceDocId))deny();
  const device=await get('pos_devices/'+binding.legacyDeviceDocId);
  if(device?.status!=='Active'||device.deviceId!==body.deviceId||device.branch!==body.branch||String(device.appType).toLowerCase()==='staff')deny();
 }else if(isAccessOwner(actor)){
  const mirrors=await tx.get(db.collection('pos_devices').where('deviceId','==',body.deviceId).limit(2));
  if(mirrors.size!==1||mirrors.docs[0].data().status!=='Active'||mirrors.docs[0].data().branch!==body.branch||String(mirrors.docs[0].data().appType).toLowerCase()==='staff')deny();
 }else deny();
 const shift=await get('shifts/'+body.shiftId);
 if(shift?.branch!==body.branch||shift.active!==true)fail(409,'Reopen the active shift for this branch.');
 return {id:session.staffId,name:profile.data().cashierName};
}
export function createCoinStash(db,{serverTimestamp,now=Date.now}){
 return async function stash(action,body,actor,ownerApp){
  const branch=body.branch;
  if(!key(branch)||!['read','configure','fund','spend'].includes(action)||ownerApp&&!isAccessOwner(actor)||!ownerApp&&!['read','spend'].includes(action)||ownerApp&&action==='spend')fail(403,'This stash action is unavailable for this account.');
  return db.runTransaction(async tx=>{
   const person=ownerApp?{id:actor.uid,name:actor.email}:await cashierIdentity(db,tx,actor,body,now());
   const linkRef=db.doc('branch_coin_stashes/'+hash(branch)),link=row(await tx.get(linkRef));
   if(link&&link.branch!==branch)fail(409,'The saved stash branch changed.');
   const accountId=action==='configure'?body.accountId:link?.accountId;
   if(!accountId&&action==='read')return {configured:false,branch};
   if(!key(accountId))fail(409,'Choose a branch cash account in Owner Cash & Budget.');
   const ref=db.doc('cash_accounts/'+accountId),account=row(await tx.get(ref));
   if(!account||account.branch!==branch)fail(409,'The chosen account is unavailable at this branch.');
   const cents=cash(account.balance),history=link?.history||[];
   const summary={configured:true,branch,accountId,name:account.name,note:link?.note||'',balance:cents/100,history,revision:link?.revision||0};
   if(action==='read')return summary;
   if(!/^[a-zA-Z0-9_-]{16,90}$/.test(body.operationId||'')||!noteText(body.note))fail(400,'Enter a short note and retry this action.');
   const entryRef=db.doc('coin_stash_events/'+hash(actor.uid+'|'+body.operationId)),prior=row(await tx.get(entryRef));
   const intent=JSON.stringify([branch,action,body.accountId,body.cents??null,body.note,body.shiftId||'',person.id]);
   if(prior){if(prior.intent!==intent)fail(409,'The earlier entry has different details. Refresh the stash.');return {saved:true,alreadySaved:true};}
   if(action==='configure'){
    if((body.revision??0)!==(link?.revision||0))fail(409,'The stash configuration changed. Reopen the branch ledger.');
    tx.set(linkRef,{branch,accountId,note:body.note.trim(),revision:(link?.revision||0)+1,history:accountId===link?.accountId?history:[]});
    tx.create(entryRef,{intent,branch,accountId,action,actor:actor.uid,timestamp:serverTimestamp()});return {saved:true};
   }
   if(body.accountId!==link?.accountId||!Number.isSafeInteger(body.cents)||body.cents<=0||body.cents>100000000||!body.note.trim())fail(400,'Choose the linked account and enter a positive amount and purchase or funding note.');
   const delta=action==='fund'?body.cents:-body.cents,balance=cents+delta;
   if(!Number.isSafeInteger(balance)||balance<0)fail(409,'There is not enough money in this stash. Refresh and check the balance.');
   const value=delta/100,amount=body.cents/100,note=body.note.trim(),timestamp=serverTimestamp(),id=entryRef.id;
   const entry={action,amount,note,by:person.name,at:new Date(now()).toISOString()};
   tx.update(ref,{balance:balance/100});
   tx.update(linkRef,{history:[entry,...history].slice(0,10)});
   tx.create(entryRef,{intent,branch,accountId,action,amount,note,actor:actor.uid,staffId:person.id,shiftId:body.shiftId||'',newBalance:balance/100,timestamp});
   tx.create(db.doc('account_logs/stash-'+id),{accountId,accountName:account.name,branch,action:action==='fund'?'Coins Stash addition':'Coins Stash purchase',amount:value,newBalance:balance/100,user:person.name,timestamp,note});
   if(action==='spend')tx.create(db.doc('expenses/stash-'+id),{branch,amount,category:'Store supplies',description:note,paidFrom:'Coins Stash',sourceAccount:account.name,accountId,stashShiftId:body.shiftId,cashier:person.name,staffId:person.id,date:new Date(Date.parse(entry.at)+8*3600000).toISOString().slice(0,10),timestamp});
   return {saved:true};
  });
 };
}
