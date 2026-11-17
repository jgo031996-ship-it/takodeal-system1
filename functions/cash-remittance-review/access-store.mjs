import {createHash,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {ACCESS_OWNER,accessId,accessDocumentId,accessText,activeAccessStaff,operationalStaffProfile,isAccessOwner} from './access-model.mjs';
import {hqSourceAccess} from './company-access-index.mjs';
import {mealRole,savedPin,resolveHQAccount} from './relief-core/hq-account-model.js';
import {activeStaffProfile} from './relief-core/staff-lifecycle-model.js';
import {freshOwnerDesktopAuthority} from './owner-desktop-authority.mjs';
import {requireMealLevel} from './relief-core/pos-config-model.js';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const denied=()=>fail(403,'access/approval','This account or device needs HQ confirmation. Keep saved orders on this device and check its approval.');
const badPin=()=>fail(403,'access/pin','The employee PIN could not be verified. Check it and try again.');
const review=()=>fail(409,'access/review','More than one saved identity or a changed account needs HQ review.');
const hash=value=>createHash('sha256').update(value).digest('hex');
const stamp=value=>value?.toMillis?.()??(value instanceof Date?+value:Date.parse(value));
const millisToken=value=>value?String(value.seconds??value._seconds)+'|'+String(value.nanoseconds??value._nanoseconds):'';
const exactPin=(saved,input)=>typeof saved==='string'?saved===input:typeof saved==='number'&&Number.isSafeInteger(saved)&&Number(input)===saved;
const numericDailyPin=input=>/^\d+$/.test(input)&&Number.isSafeInteger(Number(input))?Number(input):null;
const exactNewDailyPin=(saved,input)=>typeof saved==='string'?saved===input:typeof saved==='number'&&Number.isSafeInteger(saved)&&numericDailyPin(input)!==null&&numericDailyPin(input)===saved;
const data=snap=>snap?.exists?snap.data():null;
const privateConfig=row=>row?.enabled===true&&row.policyVersion===2&&row.brokerEndpoint==='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker';
const equalJSON=(a,b)=>{const sort=value=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;return JSON.stringify(sort(a))===JSON.stringify(sort(b));};
export function createAccessStore(db,{now=Date.now,serverTimestamp,payrollReader,payrollAcknowledger,payrollInputsReader,operationalReader,cashierShiftCloser}={}){
 if(typeof db?.runTransaction!=='function'||typeof db?.collection!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted account database is required.');
 const ref=path=>db.doc(path),read=(tx,path)=>tx.get(ref(path));
 const query=async(tx,table,field,op,value,cap=3)=>{
  const snap=await tx.get(db.collection(table).where(field,op,value).limit(cap));
  if(snap.docs.length>=cap)review();return snap.docs;
 };
 async function resolveDevice(tx,body,actor,profile,ownerDesktop){
  if(body.app==='cashier'){
   if(!accessText(body.branch))denied();
   if(isAccessOwner(actor)){
    const records=await query(tx,'pos_devices','deviceId','==',body.deviceId);
    const active=records.filter(snap=>snap.data().status==='Active');
    if(ownerDesktop&&active.length===1&&active[0].data().branch==='Main Office'){
     const rows=values=>values.map(snap=>({...snap.data(),id:snap.id}));
     ownerDesktop.value=await freshOwnerDesktopAuthority({actor,deviceId:body.deviceId,branch:body.branch,owners:async()=>rows(await query(tx,'hq_managers','email','==',ACCESS_OWNER)),devices:async()=>rows(await query(tx,'pos_devices','deviceId','==',body.deviceId)),branches:async()=>rows(await query(tx,'branches','name','==',body.branch))});return body.branch;
    }
    if(records.length!==1||records[0].data().status!=='Active'||String(records[0].data().appType||'').trim().toLowerCase()==='staff')denied();
    if(records[0].data().branch!==body.branch)denied();
    return body.branch;
   }
   const binding=data(await read(tx,'pos_bindings/'+actor.uid));
   if(binding?.uid!==actor.uid||binding.status!=='Active'||binding.deviceId!==body.deviceId||binding.branch!==body.branch||!accessId(binding.legacyDeviceDocId))denied();
   const mirror=data(await read(tx,'pos_devices/'+binding.legacyDeviceDocId));
   if(mirror?.status!=='Active'||mirror.deviceId!==body.deviceId||mirror.branch!==binding.branch||String(mirror.appType||'').trim().toLowerCase()==='staff')denied();
   return binding.branch;
  }
  const protectedBinding=data(await read(tx,'staff_app_bindings/'+actor.uid));
  if(protectedBinding){
   const config=data(await read(tx,'staff_app_setup_config/current'));
   if(config?.protocolVersion!==1||protectedBinding.status!=='Active'||protectedBinding.deviceId!==body.deviceId||protectedBinding.staffId!==profile.id||protectedBinding.branch!==profile.row.branch)denied();
   const index=data(await read(tx,'staff_app_device_index/'+body.deviceId));
   if(index?.uid!==actor.uid||index.deviceId!==body.deviceId||index.staffId!==profile.id)denied();
   const mirror=data(await read(tx,'pos_devices/'+body.deviceId));
   if(mirror?.status!=='Active'||mirror.setupUid!==actor.uid||mirror.staffId!==profile.id||mirror.deviceId!==body.deviceId||mirror.branch!==profile.row.branch)denied();
   return profile.row.branch;
  }
  // This compatibility check admits only a PIN-confirmed operational session.
  // A public legacy device ID never grants private HR/payroll/loan access.
  const config=data(await read(tx,'staff_app_setup_config/current'));
  if(config?.enabled===true)denied();
  const mirrors=await query(tx,'pos_devices','deviceId','==',body.deviceId);
  if(mirrors.length!==1||mirrors[0].data().status!=='Active'||mirrors[0].data().appType!=='Staff'||mirrors[0].data().setupVersion||mirrors[0].data().setupUid)denied();
  return profile.row.branch;
 }
 async function profileForPin(tx,pin,selected){
  const groups=await Promise.all([query(tx,'cashiers','pin','==',pin),query(tx,'cashiers','pin','==',Number(pin))]);
  const candidates=new Map();for(const snap of groups.flat())if(activeAccessStaff(snap.data())&&exactPin(snap.data().pin,pin))candidates.set(snap.id,snap);
  if(candidates.size!==1)badPin();const snap=[...candidates.values()][0];
  if(selected&&snap.id!==selected)badPin();return{id:snap.id,row:snap.data(),revision:millisToken(snap.updateTime)};
 }
 async function privateProfile(tx,body,actor){
  const [configSnap,bindingSnap,profileSnap]=await Promise.all([read(tx,'staff_document_config/current'),read(tx,'staff_document_devices/'+actor.uid),read(tx,'cashiers/'+body.staffId)]),binding=data(bindingSnap),profile=data(profileSnap);
  if(!privateConfig(data(configSnap))||binding?.active!==true||binding.uid!==actor.uid||binding.staffId!==body.staffId||binding.deviceId!==body.deviceId||!activeAccessStaff(profile)||binding.branch!==profile.branch)denied();
  return{id:body.staffId,row:profile,revision:millisToken(profileSnap.updateTime)};
 }
 async function currentSession(tx,body,actor,branch){
  const session=data(await read(tx,'staff_login_sessions/'+actor.uid));
  if(session?.schemaVersion!==1||session.uid!==actor.uid||session.sessionId!==body.sessionId||session.app!==body.app||session.branch!==branch||session.deviceId!==body.deviceId||!accessId(session.staffId)||!Number.isFinite(stamp(session.expiresAt))||stamp(session.expiresAt)<=now())denied();
  const person=await read(tx,'cashiers/'+session.staffId);if(!activeAccessStaff(data(person))||session.profileRevision!==millisToken(person.updateTime))denied();return session;
 }
 const response=(profile,branch,expiresAt,sessionId)=>({schemaVersion:1,staffId:profile.id,profile:operationalStaffProfile(profile.id,profile.row),branch,sessionExpiresAt:expiresAt.toISOString(),sessionId});
 return{
  async rate(uid,ip,kind){
   if(!accessId(uid))denied();const slot=Math.floor(now()/600000),ipKey=isIP(ip||'')?hash(ip):'shared-proxy',cleanup=kind==='staff-logout',group=cleanup?'cleanup':'account',uidLimit=cleanup?60:['verify-staff-pin','meal-identity'].includes(kind)?80:kind==='staff-options'?30:kind==='change-staff-pin'?10:kind.startsWith('staff-payroll')?60:20,limits=[[group+':uid:'+uid,uidLimit],[group+':ip:'+ipKey,500],[group+':global',2000]];
   await db.runTransaction(async tx=>{
    const paths=limits.map(([key])=>'cash_remittance_attempts/access-'+hash(key+'|'+slot)),snaps=await Promise.all(paths.map(path=>read(tx,path)));
    const counts=snaps.map(snap=>data(snap)?.count??0);
    if(counts.some((count,i)=>!Number.isSafeInteger(count)||count<0||count>=limits[i][1]))fail(429,'access/rate-limit','Too many account checks. Wait a few minutes before trying again.');
    paths.forEach((path,i)=>tx.set(ref(path),{count:counts[i]+1,expiresAt:new Date((slot+2)*600000)}));
   });
  },
  async login(body,actor){
   return db.runTransaction(async tx=>{
    if(data(await read(tx,'staff_session_cancellations/'+hash(actor.uid+'|'+body.sessionId))))fail(409,'access/cancelled','This sign-in was cancelled. Start a new sign-in.');
    const ownerDesktop={},profile=await profileForPin(tx,body.pin,body.selectedStaffId),branch=await resolveDevice(tx,body,actor,profile,ownerDesktop),expiresAt=new Date(now()+12*60*60*1000);
    const session={schemaVersion:1,uid:actor.uid,staffId:profile.id,deviceId:body.deviceId,app:body.app,branch,issuedAt:new Date(now()),expiresAt,profileRevision:profile.revision,sessionId:body.sessionId,...(ownerDesktop.value?{ownerDesktopAuthority:ownerDesktop.value}:{})};
    tx.set(ref('staff_directory/'+profile.id),{...operationalStaffProfile(profile.id,profile.row),profileRevision:profile.revision,syncedAt:serverTimestamp()});
    tx.set(ref('staff_login_sessions/'+actor.uid),session);return response(profile,branch,expiresAt,body.sessionId);
   });
  },
  async verifyPin(body,actor){
   return db.runTransaction(async tx=>{
    const receiptVoid=body.purpose==='receipt-void',ownerDesktop=receiptVoid?{}:undefined;
    if(receiptVoid&&(body.app!=='cashier'||body.sessionId!==undefined||typeof body.scope!=='string'||!/^[a-f0-9]{64}$/.test(body.scope)))denied();
    const profile=await profileForPin(tx,body.pin,body.staffId);let branch=await resolveDevice(tx,body,actor,profile,ownerDesktop);
    if(body.app==='staff'){
     const session=await currentSession(tx,body,actor,branch);if(session.staffId!==body.staffId)denied();
     if(body.branch!==undefined){
      const branches=await query(tx,'branches','name','==',body.branch);
      if(branches.length!==1||branches[0].data().active===false||branches[0].data().archived===true)denied();branch=body.branch;
     }
    }
    if(!receiptVoid&&body.app==='cashier'&&body.sessionId)await currentSession(tx,body,actor,branch);
    const verificationId='pin-'+randomUUID(),expiresAt=new Date(now()+120000);
    const proof={schemaVersion:1,uid:actor.uid,staffId:profile.id,deviceId:body.deviceId,app:body.app,branch,purpose:body.purpose,scope:body.scope||'',profileRevision:profile.revision,sessionId:receiptVoid?null:(body.sessionId||null),...(receiptVoid?{sessionMode:'receipt-only'}:{}),source:'cashiers',profile:operationalStaffProfile(profile.id,profile.row),issuedAt:new Date(now()),expiresAt,...(ownerDesktop?.value?{ownerDesktopAuthority:ownerDesktop.value}:{})};
    if(!receiptVoid)tx.set(ref('staff_directory/'+profile.id),{...proof.profile,profileRevision:profile.revision,syncedAt:serverTimestamp()});
    tx.create(ref('staff_pin_verifications/'+verificationId),proof);
    if(!receiptVoid)tx.set(ref('staff_pin_contexts/'+actor.uid+'_'+body.purpose),{...proof,verificationId});
    return{schemaVersion:1,staffId:profile.id,profile:operationalStaffProfile(profile.id,profile.row),branch,verificationId,expiresAt:expiresAt.toISOString()};
   });
  },
  async logout(body,actor){
   return db.runTransaction(async tx=>{
    const path='staff_login_sessions/'+actor.uid,row=data(await read(tx,path)),cancelPath='staff_session_cancellations/'+hash(actor.uid+'|'+body.sessionId),prior=data(await read(tx,cancelPath));
    if(row?.sessionId===body.sessionId&&(row.uid!==actor.uid||row.deviceId!==body.deviceId||row.app!==body.app))denied();
    if(!prior)tx.create(ref(cancelPath),{schemaVersion:1,uid:actor.uid,sessionId:body.sessionId,deviceId:body.deviceId,app:body.app,recordedAt:new Date(now()),expiresAt:new Date(now()+13*60*60*1000)});
    if(row?.sessionId===body.sessionId)tx.set(ref(path),{...row,expiresAt:new Date(0),revoked:true});return{schemaVersion:1,signedOut:true};
   });
  },
  async options(){
   const snap=await db.collection('cashiers').select(...OPERATIONAL_OPTION_FIELDS).limit(2001).get();
   if(snap.size>2000)review();
   const staff=snap.docs.filter(row=>activeAccessStaff(row.data())).map(row=>({staffId:row.id,name:row.data().cashierName,branch:row.data().branch}));
   return{schemaVersion:1,staff:staff.sort((a,b)=>a.name.localeCompare(b.name)||a.branch.localeCompare(b.branch))};
  },
  async changePin(body,actor){
   if(typeof body.newPin!=='string'||!/^\d{4,10}$/.test(body.newPin))fail(400,'access/request','Use 4–10 digits for your daily Staff PIN.');
   return db.runTransaction(async tx=>{
    const profile=await privateProfile(tx,body,actor),version=profile.row.loginPinVersion??0,opPath='staff_access_operations/'+hash(actor.uid+'|'+body.operationId),prior=data(await read(tx,opPath));
    if(prior){if(prior.uid!==actor.uid||prior.staffId!==body.staffId||prior.deviceId!==body.deviceId||prior.expectedVersion!==body.expectedVersion||prior.version!==version||!exactNewDailyPin(profile.row.pin,body.newPin))review();return{schemaVersion:1,staffId:body.staffId,version,changed:true,alreadySaved:true};}
    if(!Number.isSafeInteger(version)||version<0||body.expectedVersion!==version)review();
    const numeric=numericDailyPin(body.newPin),others=(await Promise.all([query(tx,'cashiers','pin','==',body.newPin),...(numeric!==null?[query(tx,'cashiers','pin','==',numeric)]:[])])).flat().filter(row=>row.id!==body.staffId&&activeAccessStaff(row.data())&&exactNewDailyPin(row.data().pin,body.newPin));
    const pinPath='staff_pin_index/'+hash('staff-login-pin|'+body.newPin),pinIndex=data(await read(tx,pinPath));let occupied=false;
    if(pinIndex&&pinIndex.staffId!==body.staffId){if(!accessId(pinIndex.staffId))review();const person=data(await read(tx,'cashiers/'+pinIndex.staffId));occupied=activeAccessStaff(person)&&exactNewDailyPin(person.pin,body.newPin);}
    if(others.length||occupied)fail(409,'access/pin-in-use','Choose another daily Staff PIN. That PIN is already assigned.');
    tx.set(ref(pinPath),{staffId:body.staffId,updatedAt:serverTimestamp()});
    tx.update(ref('cashiers/'+body.staffId),{pin:body.newPin,loginPinVersion:version+1,pinUpdatedAt:serverTimestamp()});
    tx.create(ref(opPath),{schemaVersion:1,uid:actor.uid,staffId:body.staffId,deviceId:body.deviceId,expectedVersion:body.expectedVersion,version:version+1,recordedAt:serverTimestamp()});
    return{schemaVersion:1,staffId:body.staffId,version:version+1,changed:true,alreadySaved:false};
   });
  },
  async payroll(body,actor){if(typeof payrollReader!=='function')fail(503,'access/payroll-unavailable','Your saved payroll history is not ready. Try again shortly.');return payrollReader({uid:actor.uid,...body});},
  async payrollInputs(body,actor){if(typeof payrollInputsReader!=='function')fail(503,'access/payroll-unavailable','Your payroll details are not ready. Try again shortly.');return payrollInputsReader({uid:actor.uid,...body});},
  async operationalHistory(body,actor){if(typeof operationalReader!=='function')fail(503,'access/history-unavailable','Your operational history is not ready. Try again shortly.');return operationalReader({uid:actor.uid,...body,owner:isAccessOwner(actor)});},
  async closeCashierShift(body,actor){if(typeof cashierShiftCloser!=='function')fail(503,'access/shift-unavailable','Shift closing is still loading. Keep the drawer review open and reconnect.');return cashierShiftCloser(body,actor);},
  async acknowledgePayroll(body,actor){if(typeof payrollAcknowledger!=='function')fail(503,'access/payroll-unavailable','Your saved payroll acknowledgment is not ready. Try again shortly.');return payrollAcknowledger({uid:actor.uid,...body});},
  async mealIdentity(body,actor){
   return db.runTransaction(async tx=>{
    const branch=await resolveDevice(tx,body,actor,null);
    if(body.sessionId)await currentSession(tx,body,actor,branch);
    const groups=await Promise.all([query(tx,'cashiers','pin','==',body.pin),query(tx,'cashiers','pin','==',Number(body.pin)),query(tx,'hq_managers','pin','==',body.pin),query(tx,'hq_managers','pin','==',Number(body.pin)),query(tx,'hq_managers','securityPin','==',body.pin),query(tx,'hq_managers','securityPin','==',Number(body.pin))]);
    const candidates=new Map();
    const hqEmails=new Set();groups.forEach((rows,index)=>{for(const snap of rows){if(index>=2){if(typeof snap.data().email==='string')hqEmails.add(snap.data().email);continue;}const row=snap.data(),source='cashiers',role=mealRole(row,source);if(!activeAccessStaff(row)||!exactPin(row.pin,body.pin)||!role)continue;
     candidates.set(source+'/'+snap.id,{id:snap.id,row,source,role,revision:millisToken(snap.updateTime)});
    }});
    for(const email of hqEmails){
     const records=await query(tx,'hq_managers','email','==',email,11);let row;
     try{row=resolveHQAccount(records.map(snap=>({id:snap.id,data:snap.data()})));}catch{continue;}
     const source='hq_managers',role=mealRole(row,source);
     if(!activeStaffProfile(row)||row.disabled===true||!exactPin(savedPin(row),body.pin)||!role)continue;
     const assignments=row.assignedBranch??(/franchise/i.test(row.role||'')?'':'All'),branches=Array.isArray(assignments)?assignments:String(assignments).split(',').map(value=>value.trim());
     if(!branches.includes('All')&&!branches.includes(branch))continue;
     if(String(row.email).toLowerCase()!==ACCESS_OWNER){
     const index=data(await read(tx,'hq_account_index/'+String(row.email).toLowerCase())),bridge=data(await read(tx,'hq_email_access/'+String(row.email).toLowerCase()));
      if(!index||index.schemaVersion!==1||index.active!==true||index.ambiguous!==false||index.sourceProfileId!==row.docId||!accessDocumentId(index.sourceProfileId)||!equalJSON(index.sourceAccess,hqSourceAccess(row))||index.role!==row.role||!Array.isArray(index.permissions)||!index.permissions.length||!Array.isArray(index.allowedBranches)||!index.allowedBranches.includes('All')&&!index.allowedBranches.includes(branch))continue;
      if(bridge&&(bridge.active!==true||!Array.isArray(bridge.permissions)||!index.permissions.some(permission=>bridge.permissions.includes(permission))||!Array.isArray(bridge.allowedBranches)||!bridge.allowedBranches.includes('All')&&!bridge.allowedBranches.includes(branch)||bridge.role&&bridge.role!==row.role))continue;
     }
     candidates.set(source+'/'+row.docId,{id:row.docId,row,source,role,revision:millisToken(records.find(snap=>snap.id===row.docId)?.updateTime)});
    }
    if(candidates.size!==1)badPin();const person=[...candidates.values()][0];
    const settings=data(await read(tx,'settings/global_pos_config'))||{};
    try{requireMealLevel(settings,body.mealLevelId,person.role);}catch{fail(403,'access/meal-level','This employee role is not allowed to use the selected saved meal level. Reopen checkout.');}
    const profile=person.source==='cashiers'?operationalStaffProfile(person.id,person.row):{staffId:person.id,cashierName:accessText(person.row.fullName||person.row.name)||'HQ account',branch,role:person.row.role||'Manager',active:true};
    const day=new Date(now()+8*60*60*1000).toISOString().slice(0,10);
    if(person.role==='staff'){
     const start=new Date(day+'T00:00:00+08:00'),end=new Date(+start+86400000),base=db.collection('staff_requests').where('staffName','==',profile.cashierName),[history,undated]=await Promise.all([tx.get(base.where('timestamp','>=',start).where('timestamp','<',end).limit(501)),tx.get(base.where('timestamp','==',null).limit(4))]);
     if(history.size>=501||undated.size>=4)review();
     for(const snap of [...history.docs,...undated.docs]){const row=snap.data();if(row.status==='Voided'||!(row.mealRole==='staff'||String(row.type||'').toLowerCase().includes('staff meal')))continue;
      if(row.staffId!==undefined&&(row.staffId!==person.id||row.mealIdentitySource!==undefined&&row.mealIdentitySource!==person.source))continue;
      const at=stamp(row.timestamp);if(!Number.isFinite(at))review();
      if(at>=+start&&at<+start+86400000&&row.saleId!==body.scope&&snap.id!=='meal-'+body.scope)fail(409,'access/meal-already-recorded','This employee already has a saved meal for this Philippine business day.');
     }
    }
    const verificationId='pin-'+randomUUID(),expiresAt=new Date(now()+15*60*1000),proof={schemaVersion:1,uid:actor.uid,staffId:person.id,deviceId:body.deviceId,app:'cashier',branch,purpose:'meal',scope:body.scope,mealLevelId:body.mealLevelId,day,profileRevision:person.revision,sessionId:body.sessionId||null,source:person.source,mealRole:person.role,profile,issuedAt:new Date(now()),expiresAt};
    tx.create(ref('staff_pin_verifications/'+verificationId),proof);tx.set(ref('staff_pin_contexts/'+actor.uid+'_meal'),{...proof,verificationId});
    return{schemaVersion:1,staffId:person.id,profile,branch,verificationId,expiresAt:expiresAt.toISOString(),source:person.source,mealRole:person.role,day,mealLevelId:body.mealLevelId,scope:body.scope};
   });
  }
 };
}
const OPERATIONAL_OPTION_FIELDS=['cashierName','branch','pin','active','isActive','status','archived','isArchived','blocked','isDeleted','deleted','revoked','offboarded','resigned','terminated','disabled','employmentStatus','contractStatus'];
