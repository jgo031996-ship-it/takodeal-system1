import {randomBytes,pbkdf2 as derive,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {activeAccessStaff} from './access-model.mjs';
import {readPrivateStaffPhone} from './personal-vault-phone.mjs';
import {profileHash,profileId,profileDevice,profileError} from './staff-private-profile-model.mjs';
const pbkdf2=promisify(derive);
export const exactDailyPin=(saved,value)=>typeof saved==='string'?saved===value:typeof saved==='number'&&Number.isSafeInteger(saved)&&typeof value==='string'&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&saved===Number(value);
export async function pinProof(pin){const salt=randomBytes(16).toString('hex');return{salt,hash:(await pbkdf2(String(pin),salt,120000,32,'sha256')).toString('hex')};}
export async function matchesPinProof(pin,proof){return /^[a-f0-9]{32}$/.test(proof?.salt||'')&&/^[a-f0-9]{64}$/.test(proof?.hash||'')&&timingSafeEqual(await pbkdf2(String(pin),proof.salt,120000,32,'sha256'),Buffer.from(proof.hash,'hex'));}
export const sessionPath=uid=>'staff_access_operations/self-session-'+uid;
export async function readSessionPhone(tx,db,{uid,staffId,deviceId},profile,now=Date.now()){
 if(!profileId(uid)||!profileId(staffId)||!profileDevice(deviceId)||!activeAccessStaff(profile))return null;
 try{await readPrivateStaffPhone(tx,db,{uid,staffId,deviceId},()=>{throw Error('Unconfirmed personal phone');});}catch{return null;}
 const [session,device,binding]=await Promise.all([sessionPath(uid),'pos_devices/'+deviceId,'staff_app_bindings/'+uid].map(p=>tx.get(db.doc(p))));
 const saved=session.exists?session.data():null,phone=device.exists?device.data():null,bound=binding.exists?binding.data():null;
 if(saved?.kind!=='staff-self-session-v1'||saved.uid!==uid||saved.staffId!==staffId||saved.deviceId!==deviceId||saved.expiresAt<=now||!Number.isSafeInteger(saved.expiresAt)||saved.pinVersion!==(profile.loginPinVersion??0)||phone?.status!=='Active'||phone.appType!=='Staff'||phone.staffId&&phone.staffId!==staffId)return null;
 if(bound&&(bound.status!=='Active'||bound.staffId!==staffId||bound.deviceId!==deviceId||bound.uid!==uid))return null;
 if(bound){const credential=await tx.get(db.doc('staff_setup_credentials/'+staffId));if(!credential.exists||credential.data().enabled!==true)return null;}
 if(!await matchesPinProof(profile.pin,saved.pinProof))return null;
 return{staffId,deviceId,branch:profile.branch,expiresAt:saved.expiresAt};
}
export function createStaffSessionStore(db,{now=Date.now}={}){
 const deny=()=>{throw profileError(403,'approval','Confirm your daily Staff PIN on this active phone.');};
 function scope(input,actor){if(actor?.firebase?.sign_in_provider!=='anonymous'||!profileId(actor.uid)||!profileId(input?.staffId)||!profileDevice(input.deviceId))deny();return{uid:actor.uid,staffId:input.staffId,deviceId:input.deviceId};}
 async function rate(input,actor,ip){const keys=[actor.uid,input.staffId,ip||'unknown'],slot=Math.floor(now()/900000);return db.runTransaction(async tx=>{const refs=keys.map((key,i)=>db.doc('cash_remittance_attempts/self-'+profileHash({key,i,slot}))),snaps=await Promise.all(refs.map(ref=>tx.get(ref)));for(let i=0;i<snaps.length;i++){const count=snaps[i].exists?snaps[i].data().count:0;if(!Number.isSafeInteger(count)||count<0||count>=(i===2?120:12))throw profileError(429,'rate','Too many PIN attempts. Wait 15 minutes before trying again.');}snaps.forEach((snap,i)=>tx.set(refs[i],{count:(snap.exists?snap.data().count:0)+1,expiresAt:new Date((slot+2)*900000)}));});}
 return{
  async login(input,actor,ip){const who=scope(input,actor);if(typeof input.pin!=='string'||input.pin.length<1||input.pin.length>100||Object.keys(input).sort().join(',')!=='deviceId,pin,staffId')deny();await rate(input,actor,ip);return db.runTransaction(async tx=>{
   await readPrivateStaffPhone(tx,db,who,deny);
   const [snap,device,binding]=await Promise.all(['cashiers/'+who.staffId,'pos_devices/'+who.deviceId,'staff_app_bindings/'+who.uid].map(p=>tx.get(db.doc(p))));const p=snap.exists?snap.data():null,d=device.exists?device.data():null,b=binding.exists?binding.data():null;
   if(!activeAccessStaff(p)||!exactDailyPin(p.pin,input.pin)||d?.status!=='Active'||d.appType!=='Staff'||d.staffId&&d.staffId!==who.staffId||b&&(b.status!=='Active'||b.staffId!==who.staffId||b.deviceId!==who.deviceId||b.uid!==who.uid))deny();
   if(b){const credential=await tx.get(db.doc('staff_setup_credentials/'+who.staffId));if(!credential.exists||credential.data().enabled!==true)deny();}
   if(!b&&!d.staffId){const staff=await tx.get(db.collection('cashiers').limit(2001));if(staff.docs.length>2000||staff.docs.some(row=>row.id!==who.staffId&&activeAccessStaff(row.data())&&exactDailyPin(row.data().pin,input.pin)))throw profileError(409,'approval','This daily PIN is shared by more than one employee. Use your personal setup code to identify your phone, then sign in.');}
   const expiresAt=now()+8*60*60*1000;tx.set(db.doc(sessionPath(who.uid)),{kind:'staff-self-session-v1',...who,pinVersion:p.loginPinVersion??0,pinProof:await pinProof(p.pin),expiresAt});return{...who,branch:p.branch,expiresAt};
  });},
  async status(input,actor){const who=scope(input,actor);return db.runTransaction(async tx=>{const snap=await tx.get(db.doc('cashiers/'+who.staffId)),result=await readSessionPhone(tx,db,who,snap.exists?snap.data():null,now());if(!result)deny();return result;});},
  async logout(input,actor){const who=scope(input,actor);await db.runTransaction(async tx=>{const ref=db.doc(sessionPath(who.uid)),snap=await tx.get(ref);if(snap.exists&&snap.data().staffId===who.staffId&&snap.data().deviceId===who.deviceId)tx.delete(ref);});return{signedOut:true};}
 };
}
