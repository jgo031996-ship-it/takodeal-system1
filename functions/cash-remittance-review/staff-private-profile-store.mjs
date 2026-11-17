import {readPrivateStaffPhone} from './personal-vault-phone.mjs';
import {activeAccessStaff} from './access-model.mjs';
import {randomBytes,pbkdf2 as pbkdf2Callback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {profileError,profileId,profileHash,profileIntent,privateProfileFingerprint,projectPrivateProfile} from './staff-private-profile-model.mjs';
const denied=()=>{throw profileError(403,'approval','Use your personally approved private Staff phone. Ask HQ to check private access.');};
const changed=()=>{throw profileError(409,'changed','Your profile changed. Refresh it before saving; your entered fields have been kept.');};
const pbkdf2=promisify(pbkdf2Callback),validVerifier=value=>value?.version===1&&value.iterations===300000&&/^[a-f0-9]{32}$/.test(value.salt||'')&&/^[a-f0-9]{64}$/.test(value.hash||'')&&Object.keys(value).sort().join(',')==='hash,iterations,salt,version';
const hashPin=async value=>{const salt=randomBytes(16).toString('hex');return{version:1,iterations:300000,salt,hash:(await pbkdf2(value,Buffer.from(salt,'hex'),300000,32,'sha256')).toString('hex')};};
const verifyPin=async(value,verifier)=>validVerifier(verifier)&&timingSafeEqual(await pbkdf2(value,Buffer.from(verifier.salt,'hex'),300000,32,'sha256'),Buffer.from(verifier.hash,'hex'));
const exactDailyPin=(saved,value)=>typeof saved==='string'?saved===value:typeof saved==='number'&&Number.isSafeInteger(saved)&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&saved===Number(value);
export function createStaffPrivateProfileStore(db,{now=Date.now,serverTimestamp}={}){
 if(typeof db?.runTransaction!=='function'||typeof db?.doc!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted private profile database is required.');
 async function authority(tx,input,actor){
  if(actor?.firebase?.sign_in_provider!=='anonymous'||!profileId(actor?.uid))denied();
  const profileSnap=await readPrivateStaffPhone(tx,db,{uid:actor.uid,...input},denied);
  return profileSnap;
 }
 async function read(body,actor){const input=profileIntent('read',body);return db.runTransaction(async tx=>{
  const snapshot=await authority(tx,input,actor),source=snapshot.data();let timeline;
  if(source.salaryRateVersion===1){const saved=await tx.get(db.doc('staff_salary_rates/'+input.staffId));if(!saved.exists||saved.data().staffId!==input.staffId||saved.data().branch!==source.branch||saved.data().revision!==source.salaryRateRevision)throw profileError(409,'review','Your dated salary history needs HQ review.');timeline=saved.data();}
  return{schemaVersion:1,staffId:input.staffId,expectedFingerprint:privateProfileFingerprint(snapshot),profile:projectPrivateProfile(input.staffId,source,timeline),legacyDocumentPresent:{sss:typeof source.sssIdUrl==='string'&&!!source.sssIdUrl,philhealth:typeof source.philhealthIdUrl==='string'&&!!source.philhealthIdUrl,pagibig:typeof source.pagibigIdUrl==='string'&&!!source.pagibigIdUrl}};
 });}
 async function update(body,actor){const input=profileIntent('update',body),requestHash=profileHash(input),operationPath='staff_access_operations/profile-'+profileHash({uid:actor.uid,operationId:input.operationId});return db.runTransaction(async tx=>{
  const snapshot=await authority(tx,input,actor),operation=await tx.get(db.doc(operationPath));
  if(operation.exists){const row=operation.data();if(row.schemaVersion!==1||row.uid!==actor.uid||row.staffId!==input.staffId||row.deviceId!==input.deviceId||row.requestHash!==requestHash)changed();return{schemaVersion:1,staffId:input.staffId,operationId:input.operationId,saved:true,alreadySaved:true};}
  if(privateProfileFingerprint(snapshot)!==input.expectedFingerprint)changed();
  tx.update(db.doc('cashiers/'+input.staffId),input.patch);
  tx.create(db.doc(operationPath),{schemaVersion:1,uid:actor.uid,staffId:input.staffId,deviceId:input.deviceId,operationId:input.operationId,requestHash,expectedFingerprint:input.expectedFingerprint,fields:Object.keys(input.patch).sort(),recordedAt:serverTimestamp()});
  return{schemaVersion:1,staffId:input.staffId,operationId:input.operationId,saved:true,alreadySaved:false};
 });}
 async function rate(uid){const slot=Math.floor(now()/60000),ref=db.doc('cash_remittance_attempts/profile-'+profileHash({uid,slot}));return db.runTransaction(async tx=>{const snap=await tx.get(ref),count=snap.exists?snap.data().count:0;if(!Number.isSafeInteger(count)||count<0||count>=30)throw profileError(429,'rate','Too many profile checks. Wait a minute and retry.');tx.set(ref,{count:count+1,expiresAt:new Date((slot+2)*60000)});});}
 async function vaultSettings(body,actor){const input=profileIntent('vault-settings',body);return db.runTransaction(async tx=>{const snap=await authority(tx,input,actor),row=snap.data(),managed=row.payslipPinManaged===true,version=managed?row.payslipPinVersion:0;if(managed&&(!Number.isSafeInteger(version)||version<1)||!managed&&row.payslipPinVersion!=null&&row.payslipPinVersion!==0||row.payslipPin!=null&&!validVerifier(row.payslipPin))throw profileError(409,'review','Your Payslip PIN settings need HQ review.');return{schemaVersion:1,staffId:input.staffId,expectedFingerprint:privateProfileFingerprint(snap),verifier:row.payslipPin??null,managed,version};});}
 async function vaultSave(body,actor){
  const input=profileIntent('vault-save',body),operationPath='staff_access_operations/vault-'+profileHash({uid:actor.uid,operationId:input.operationId});
  await db.runTransaction(tx=>authority(tx,input,actor));
  // Only salted, deliberately slow verifiers are persisted for lost-ACK intent
  // matching. Neither PIN nor a fast digest of either PIN is stored in audits.
  const generated=await hashPin(input.newPin),currentVerifier=await hashPin(input.currentPin);
  return db.runTransaction(async tx=>{
   const snap=await authority(tx,input,actor),operation=await tx.get(db.doc(operationPath)),row=snap.data();
   if(operation.exists){const prior=operation.data();if(prior.schemaVersion!==1||prior.uid!==actor.uid||prior.staffId!==input.staffId||prior.deviceId!==input.deviceId||prior.mode!==input.mode||prior.expectedFingerprint!==input.expectedFingerprint||!await verifyPin(input.currentPin,prior.currentVerifier)||!await verifyPin(input.newPin,prior.verifier)||row.payslipPinManaged===true||profileHash(row.payslipPin)!==profileHash(prior.verifier))changed();return{schemaVersion:1,staffId:input.staffId,operationId:input.operationId,saved:true,alreadySaved:true};}
   if(privateProfileFingerprint(snap)!==input.expectedFingerprint)changed();
   if(row.payslipPinManaged===true)throw profileError(409,'managed','Use Forgot Payslip PIN to change these managed PIN settings.');
   if(row.payslipPinVersion!=null&&row.payslipPinVersion!==0||input.mode==='setup'&&row.payslipPin!=null||input.mode==='change'&&!validVerifier(row.payslipPin))changed();
   const valid=input.mode==='setup'?exactDailyPin(row.pin,input.currentPin):await verifyPin(input.currentPin,row.payslipPin);
   if(!valid)throw profileError(403,'pin','The current PIN could not be verified. Check it and try again.');
   if(exactDailyPin(row.pin,input.newPin))throw profileError(400,'pin','Choose a Payslip PIN different from your daily Staff PIN.');
   tx.update(db.doc('cashiers/'+input.staffId),{payslipPin:generated});
   tx.create(db.doc(operationPath),{schemaVersion:1,uid:actor.uid,staffId:input.staffId,deviceId:input.deviceId,operationId:input.operationId,mode:input.mode,expectedFingerprint:input.expectedFingerprint,currentVerifier,verifier:generated,recordedAt:serverTimestamp()});
   return{schemaVersion:1,staffId:input.staffId,operationId:input.operationId,saved:true,alreadySaved:false};
  });
 }
 return{read,update,rate,vaultSettings,vaultSave};
}
