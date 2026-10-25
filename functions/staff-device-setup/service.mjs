import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {isIP} from 'node:net';

export const ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDeviceSetup';
export const PROTOCOL_VERSION=1;
export const OWNER_EMAIL='jgo031996@gmail.com';
export const PRODUCTION_ORIGINS=['https://takodeal-staff.vercel.app','https://takodeal-owner.vercel.app'];
export const MAX_REQUEST_BYTES=4096;
// Owner-selected limit. A reset/new Firebase identity is another registration;
// only an explicit Owner block/delete releases that account's active slot.
export const MAX_ACTIVE_DEVICES=2;
export const RATE_LIMITS=Object.freeze({windowMs:15*60*1000,uid:12,ip:80,global:500});
const scrypt=promisify(scryptCallback),PARAMS=Object.freeze({N:16384,r:8,p:1,maxmem:64*1024*1024});
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const sha=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const deviceId=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const operationId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{8,128}$/.test(value);
const code=value=>typeof value==='string'&&/^\d{10}$/.test(value);
const object=value=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
const plainText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const version=value=>Number.isSafeInteger(value)&&value>=0;
const routes=new Set(['/config','/policy','/code-status','/issue-code','/disable-code','/activate','/device-status','/device-action']);
const ownerRoutes=new Set(['/policy','/code-status','/issue-code','/disable-code','/device-action']);
const configPath='staff_app_setup_config/current';
const bindingPath=uid=>'staff_app_bindings/'+uid,indexPath=key=>'staff_app_device_index/'+key,mirrorPath=key=>'pos_devices/'+key,credentialPath=key=>'staff_setup_credentials/'+key;
const slotsPath=staffId=>'staff_setup_device_slots/'+staffId;
class SetupError extends Error {constructor(status,kind,message){super(message);this.status=status;this.kind=kind;}}
const fail=(status,kind,message)=>{throw new SetupError(status,kind,message);};
const invalidCode=()=>fail(403,'setup-code-invalid','The setup code could not be verified. Check it with HQ and try again.');
const unavailable=()=>fail(403,'device-unavailable','This phone could not be verified. Contact HQ before signing in.');
const changed=()=>fail(409,'version-changed','This record changed. Refresh it before continuing.');
const registryUnavailable=()=>fail(503,'device-registry-unavailable','HQ must review the saved phone registrations before this account can be changed.');
const deviceLimit=()=>fail(409,'device-limit',`This staff account already has ${MAX_ACTIVE_DEVICES} active phones. Ask the Owner to block or delete an old phone registration before activating this one.`);
const safeVerifier=value=>object(value)&&value.algorithm==='scrypt-v1'&&value.N===16384&&value.r===8&&value.p===1&&/^[a-f0-9]{32}$/.test(value.salt)&&/^[a-f0-9]{64}$/.test(value.hash)&&Object.keys(value).sort().join(',')==='N,algorithm,hash,p,r,salt';
const dummyVerifier={algorithm:'scrypt-v1',N:16384,r:8,p:1,salt:'0'.repeat(32),hash:'0'.repeat(64)};
export async function hashSetupCode(value) {
 if(!code(value))throw Error('Setup code must contain exactly ten digits.');
 const salt=randomBytes(16).toString('hex'),key=await scrypt(value,Buffer.from(salt,'hex'),32,PARAMS);
 return {algorithm:'scrypt-v1',N:16384,r:8,p:1,salt,hash:key.toString('hex')};
}
export async function verifySetupCode(value,verifier) {
 if(!code(value)||!safeVerifier(verifier))return false;
 const key=await scrypt(value,Buffer.from(verifier.salt,'hex'),32,PARAMS);
 return timingSafeEqual(key,Buffer.from(verifier.hash,'hex'));
}
export function activeSetupStaff(profile) {
 const inactive=new Set(['blocked','revoked','terminated','resigned','inactive','disabled','archived','deleted']);
 return object(profile)&&profile.active!==false&&profile.archived!==true&&profile.blocked!==true
  &&!inactive.has(String(profile.status??'').trim().toLowerCase())&&!['REVOKED','BLOCKED'].includes(String(profile.pin??'').trim().toUpperCase())
  &&plainText(profile.cashierName,160)&&plainText(profile.branch,128);
}
function configOf(record) {
 if(record==null)return {enabled:false,revision:0,protocolVersion:PROTOCOL_VERSION};
 if(!object(record)||typeof record.enabled!=='boolean'||!version(record.revision)||record.protocolVersion!==PROTOCOL_VERSION)fail(503,'policy-unavailable','Staff setup is unavailable. Ask HQ to check its configuration.');
 return {enabled:record.enabled,revision:record.revision,protocolVersion:PROTOCOL_VERSION};
}
function credentialOf(record,staffId) {
 if(record==null)return null;
 if(!object(record)||record.staffId!==staffId||record.deviceSlotsVersion!==1||!Number.isSafeInteger(record.deviceSlotsRevision)||record.deviceSlotsRevision<1||!/^[a-f0-9]{64}$/.test(record.deviceSlotsHash)||typeof record.enabled!=='boolean'||!Number.isSafeInteger(record.version)||record.version<1
  ||record.enabled&&!safeVerifier(record.verifier)||record.issuedAt!==null&&typeof record.issuedAt!=='string')fail(503,'credential-unavailable','Staff setup is unavailable. Ask HQ to review this account.');
 return record;
}
const credentialStatus=(record,staffId)=>({staffId,enabled:record?.enabled===true,version:record?.version??0,issuedAt:record?.issuedAt??null});
function bindingOf(record,uid) {
 if(record==null)return null;
 if(!object(record)||record.protocolVersion!==1||record.uid!==uid||!id(record.staffId)||!deviceId(record.deviceId)||!plainText(record.staffName,160)||!plainText(record.branch,128)
  ||!['Active','Blocked','Deleted'].includes(record.status)||!plainText(record.deviceName,80))unavailable();
 return record;
}
function validIndex(record,binding) {
 return object(record)&&record.protocolVersion===1&&record.uid===binding.uid&&record.staffId===binding.staffId&&record.deviceId===binding.deviceId;
}
const reservedMirror=record=>record&&(Object.hasOwn(record,'setupVersion')||Object.hasOwn(record,'setupUid'));
const matchesMirror=(binding,mirror)=>object(mirror)&&mirror.appType==='Staff'&&mirror.setupVersion===1&&mirror.setupUid===binding.uid&&mirror.staffId===binding.staffId&&mirror.deviceId===binding.deviceId&&mirror.branch===binding.branch;
function protectedDevice(binding,index,mirror,profile) {
 if(!validIndex(index,binding))unavailable();
 if(binding.status==='Deleted') {
  if(mirror!=null)unavailable();
  return {staffId:binding.staffId,staffName:binding.staffName,branch:binding.branch,deviceId:binding.deviceId,status:'Deleted'};
 }
 if(!matchesMirror(binding,mirror))unavailable();
 const activeProfile=activeSetupStaff(profile)&&profile.branch.trim()===binding.branch;
 const status=binding.status==='Active'&&mirror.status==='Active'&&activeProfile?'Active':'Blocked';
 return {staffId:binding.staffId,staffName:activeProfile?profile.cashierName.trim():binding.staffName,branch:binding.branch,deviceId:binding.deviceId,status};
}
function bodyFor(path,body) {
 if(!object(body))fail(400,'invalid-request','Check the setup request and try again.');
 const fields={
  '/config':[], '/policy':['enabled','expectedRevision','operationId'], '/code-status':['staffId'],
  '/issue-code':['staffId','code','expectedVersion','operationId'], '/disable-code':['staffId','expectedVersion','operationId'],
  '/activate':['staffId','code','deviceId','deviceName','operationId'], '/device-status':['deviceId'], '/device-action':['deviceId','action','operationId']
 }[path];
 if(Object.keys(body).sort().join(',')!==[...fields].sort().join(','))fail(400,'invalid-request','Check the setup request and try again.');
 if(fields.includes('staffId')&&!id(body.staffId)||fields.includes('deviceId')&&!deviceId(body.deviceId)||fields.includes('operationId')&&!operationId(body.operationId)
  ||fields.includes('code')&&!code(body.code)||fields.includes('expectedVersion')&&!version(body.expectedVersion)||fields.includes('expectedRevision')&&!version(body.expectedRevision)
  ||fields.includes('enabled')&&typeof body.enabled!=='boolean'||fields.includes('deviceName')&&!plainText(body.deviceName,80)
  ||fields.includes('action')&&!['block','unblock','delete'].includes(body.action))fail(400,'invalid-request','Check the setup request and try again.');
 return body;
}

// store.transaction(callback) must provide atomic get(path), set(path,data), delete(path).
// All transaction reads precede writes. The production adapter uses Admin SDK ADC.
export function createStaffDeviceSetup({verifyToken,store,now=Date.now,hashCode=hashSetupCode,verifyCode=verifySetupCode,allowedOrigins=PRODUCTION_ORIGINS,ownerEmail=OWNER_EMAIL}={}) {
 if(typeof verifyToken!=='function'||typeof store?.transaction!=='function')throw Error('Trusted authentication and atomic storage are required.');
 const origins=new Set(allowedOrigins);
 if([...origins].some(origin=>{try{const url=new URL(origin);return url.protocol!=='https:'||url.origin!==origin||url.username||url.password;}catch{return true;}}))throw Error('Setup origins must be exact HTTPS origins.');
 const time=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)throw Error('Trusted time is unavailable.');return value;};
 const owner=actor=>actor?.email_verified===true&&typeof actor.email==='string'&&actor.email.toLowerCase()===ownerEmail.toLowerCase();
 async function readSlots(tx,staffId,saved,credential) {
  if(saved==null){if(credential)registryUnavailable();return null;}
  if(!credential||!object(saved)||saved.protocolVersion!==1||saved.staffId!==staffId||!Number.isSafeInteger(saved.revision)||saved.revision<1
   ||!Array.isArray(saved.activeDevices)||saved.activeDevices.length>MAX_ACTIVE_DEVICES||typeof saved.createdAt!=='string'||typeof saved.updatedAt!=='string'
   ||Object.keys(saved).sort().join(',')!=='activeDevices,createdAt,protocolVersion,revision,staffId,updatedAt')registryUnavailable();
  if(credential.deviceSlotsRevision!==saved.revision||credential.deviceSlotsHash!==sha(canonical(saved)))registryUnavailable();
  const uids=new Set(),ids=new Set();
  for(const item of saved.activeDevices){if(!object(item)||Object.keys(item).sort().join(',')!=='deviceId,uid'||!id(item.uid)||!deviceId(item.deviceId)||uids.has(item.uid)||ids.has(item.deviceId))registryUnavailable();uids.add(item.uid);ids.add(item.deviceId);}
  const references=await Promise.all(saved.activeDevices.map(async item=>{
   const [rawBinding,index,mirror]=await Promise.all([tx.get(bindingPath(item.uid)),tx.get(indexPath(item.deviceId)),tx.get(mirrorPath(item.deviceId))]);
   let binding;try{binding=bindingOf(rawBinding,item.uid);}catch{registryUnavailable();}
   if(!binding||binding.staffId!==staffId||binding.deviceId!==item.deviceId||binding.status!=='Active'||!validIndex(index,binding)||!matchesMirror(binding,mirror)||mirror.status!=='Active')registryUnavailable();
   return item;
  }));
  return {...saved,activeDevices:references.map(item=>({...item}))};
 }
 function assertBindingSlot(slots,binding) {
  if(!slots)registryUnavailable();
  const item=slots.activeDevices.find(item=>item.uid===binding.uid);
  if(binding.status==='Active'?(!item||item.deviceId!==binding.deviceId):Boolean(item))registryUnavailable();
 }
 async function auth(request,required=true) {
  if(!request.authorization&&!required)return null;
  if(typeof request.authorization!=='string'||!/^Bearer [A-Za-z0-9._-]{20,4096}$/.test(request.authorization))fail(401,'authentication-required','Connect and sign in again before setting up this phone.');
  let actor;try{actor=await verifyToken(request.authorization.slice(7),true);}catch{fail(401,'authentication-required','Connect and sign in again before setting up this phone.');}
  if(!id(actor?.uid)||!object(actor.firebase)||typeof actor.firebase.sign_in_provider!=='string')fail(401,'authentication-required','Connect and sign in again before setting up this phone.');
  return actor;
 }
 const requestHash=(route,body,uid)=>sha(canonical({route,uid,body:Object.fromEntries(Object.entries(body).filter(([key])=>key!=='code'))}));
 async function readPrior(tx,operationId) {
  const [prior,audit]=await Promise.all([tx.get('staff_setup_operations/'+operationId),tx.get('staff_setup_audit/'+operationId)]);
  if(Boolean(prior)!==Boolean(audit))fail(503,'operation-unavailable','HQ must review this setup operation before it can be retried.');
  return prior;
 }
 async function priorResult(prior,route,body,actor) {
  if(!prior)return null;
  if(prior.protocolVersion!==1||prior.actorUid!==actor.uid||prior.route!==route||prior.requestHash!==requestHash(route,body,actor.uid)||!object(prior.result))fail(409,'operation-conflict','This retry does not match the original request. Refresh before continuing.');
  if(Object.hasOwn(body,'code')&&(!safeVerifier(prior.codeVerifier)||!await verifyCode(body.code,prior.codeVerifier)))fail(409,'operation-conflict','This retry does not match the original request. Refresh before continuing.');
  return structuredClone(prior.result);
 }
 function saveOperation(tx,route,body,actor,result,stamp,verifier=null,details={}) {
  const operation={protocolVersion:1,actorUid:actor.uid,route,requestHash:requestHash(route,body,actor.uid),result,recordedAt:stamp};
  if(verifier)operation.codeVerifier=verifier;
  tx.set('staff_setup_operations/'+body.operationId,operation);
  tx.set('staff_setup_audit/'+body.operationId,{protocolVersion:1,operationId:body.operationId,actorUid:actor.uid,event:route.slice(1),recordedAt:stamp,...details});
 }
 async function consumeAttempt(actor,trustedIP) {
  const clock=time(),ip=isIP(String(trustedIP??''))?String(trustedIP).toLowerCase():'unknown';
  const buckets=[['uid',actor.uid,RATE_LIMITS.uid],['ip',ip,RATE_LIMITS.ip],['global','activation',RATE_LIMITS.global]];
  await store.transaction(async tx=>{
   const records=await Promise.all(buckets.map(async([kind,key,limit])=>{const path='staff_setup_attempts/'+kind+'-'+sha(key),before=await tx.get(path);return {kind,limit,path,before};}));
   const plans=records.map(row=>{const before=row.before;if(before!=null&&(!object(before)||!Number.isSafeInteger(before.count)||before.count<0||!Number.isSafeInteger(before.windowStart)||before.windowStart<0))fail(503,'attempts-unavailable','Staff setup is temporarily unavailable. Try again later.');
    const keep=before&&clock-before.windowStart<RATE_LIMITS.windowMs;const count=keep?before.count+1:1;
    if(count>row.limit)fail(429,'try-later','Too many setup attempts. Wait before trying again or ask HQ for help.');
    return {...row,data:{protocolVersion:1,kind:row.kind,count,windowStart:keep?before.windowStart:clock,updatedAt:new Date(clock).toISOString()}};
   });
   for(const plan of plans)tx.set(plan.path,plan.data);
  });
 }
 async function configuration(){return store.transaction(async tx=>({...configOf(await tx.get(configPath)),deviceLimit:MAX_ACTIVE_DEVICES}));}
 async function policy(body,actor) {
  return store.transaction(async tx=>{
   const [prior,record]=await Promise.all([readPrior(tx,body.operationId),tx.get(configPath)]),current=configOf(record),retry=await priorResult(prior,'/policy',body,actor);
   if(retry){if(canonical(retry)!==canonical(current))changed();return retry;}
   if(body.expectedRevision!==current.revision)changed();
   const result={enabled:body.enabled,revision:current.revision+1,protocolVersion:1},stamp=new Date(time()).toISOString();
   tx.set(configPath,{...result,updatedAt:stamp,updatedByUid:actor.uid});saveOperation(tx,'/policy',body,actor,result,stamp,null,{enabled:body.enabled,revision:result.revision});return result;
  });
 }
 async function manageCode(route,body,actor) {
  const verifier=route==='/issue-code'?await hashCode(body.code):null;
  if(verifier&&!safeVerifier(verifier))throw Error('Trusted code verifier is invalid.');
  return store.transaction(async tx=>{
   const [prior,saved,profile,savedSlots]=await Promise.all([readPrior(tx,body.operationId),tx.get(credentialPath(body.staffId)),tx.get('cashiers/'+body.staffId),tx.get(slotsPath(body.staffId))]),current=credentialOf(saved,body.staffId),slots=await readSlots(tx,body.staffId,savedSlots,current),retry=await priorResult(prior,route,body,actor);
   if(retry){if(canonical(retry)!==canonical(credentialStatus(current,body.staffId))||route==='/issue-code'&&canonical(current?.verifier)!==canonical(prior.codeVerifier))changed();return retry;}
   if(body.expectedVersion!==(current?.version??0))changed();
   if(route==='/issue-code'&&!activeSetupStaff(profile))fail(409,'staff-unavailable','Choose an active staff account before issuing a setup code.');
   const stamp=new Date(time()).toISOString(),initialSlots=slots??{protocolVersion:1,staffId:body.staffId,revision:1,activeDevices:[],createdAt:stamp,updatedAt:stamp};
   const record={protocolVersion:1,deviceSlotsVersion:1,deviceSlotsRevision:initialSlots.revision,deviceSlotsHash:sha(canonical(initialSlots)),staffId:body.staffId,enabled:route==='/issue-code',version:(current?.version??0)+1,issuedAt:route==='/issue-code'?stamp:current?.issuedAt??null,updatedAt:stamp,updatedByUid:actor.uid};
   if(verifier)record.verifier=verifier;
   const result=credentialStatus(record,body.staffId);tx.set(credentialPath(body.staffId),record);
   // A first credential creates its empty registry in the same transaction.
   // An existing credential with a missing registry is never assumed empty.
   if(!slots)tx.set(slotsPath(body.staffId),initialSlots);
   saveOperation(tx,route,body,actor,result,stamp,verifier,{staffId:body.staffId,version:record.version,enabled:record.enabled});return result;
  });
 }
 async function codeStatus(body) {return store.transaction(async tx=>{
  const [saved,savedSlots]=await Promise.all([tx.get(credentialPath(body.staffId)),tx.get(slotsPath(body.staffId))]),credential=credentialOf(saved,body.staffId),slots=await readSlots(tx,body.staffId,savedSlots,credential);
  return {...credentialStatus(credential,body.staffId),activeDevices:slots?.activeDevices.length??0,deviceLimit:MAX_ACTIVE_DEVICES};
 });}
 async function activate(body,actor,trustedIP) {
  if(actor.firebase.sign_in_provider!=='anonymous')fail(403,'staff-auth-required','Set up this phone through the Staff app.');
  await consumeAttempt(actor,trustedIP);
  return store.transaction(async tx=>{
   const [prior,config,credential,profile,storedBinding,index,mirror,savedSlots]=await Promise.all([
    readPrior(tx,body.operationId),tx.get(configPath),tx.get(credentialPath(body.staffId)),tx.get('cashiers/'+body.staffId),tx.get(bindingPath(actor.uid)),tx.get(indexPath(body.deviceId)),tx.get(mirrorPath(body.deviceId)),tx.get(slotsPath(body.staffId))
   ]);
   const cfg=configOf(config),binding=bindingOf(storedBinding,actor.uid),retry=await priorResult(prior,'/activate',body,actor);
   if(retry){if(!binding||binding.deviceId!==body.deviceId||binding.staffId!==body.staffId)unavailable();const current=credentialOf(credential,body.staffId),slots=await readSlots(tx,body.staffId,savedSlots,current);assertBindingSlot(slots,binding);const currentDevice=protectedDevice(binding,index,mirror,profile);if(currentDevice.status!=='Active')unavailable();return {...retry,enabled:cfg.enabled,device:currentDevice};}
   if(!cfg.enabled)fail(409,'setup-not-enabled','Personal setup codes are not enabled yet. Ask HQ before continuing.');
   if(binding||index||reservedMirror(mirror))unavailable();
   const current=credentialOf(credential,body.staffId),verifier=current?.enabled&&safeVerifier(current.verifier)?current.verifier:dummyVerifier;
   const matches=await verifyCode(body.code,verifier);
   if(!current?.enabled||!matches||!activeSetupStaff(profile))invalidCode();
   const slots=await readSlots(tx,body.staffId,savedSlots,current);if(!slots)registryUnavailable();
   if(slots.activeDevices.length>=MAX_ACTIVE_DEVICES)deviceLimit();
   const stamp=new Date(time()).toISOString(),device={staffId:body.staffId,staffName:profile.cashierName.trim(),branch:profile.branch.trim(),deviceId:body.deviceId,status:'Active'};
   // A legacy record cannot be claimed by a new anonymous identity merely by
   // guessing its public device ID. Migration creates a fresh protected ID.
   if(mirror!=null)unavailable();
   const next={protocolVersion:1,uid:actor.uid,...device,deviceName:body.deviceName.trim(),codeVersion:current.version,recordVersion:1,lastOperationId:body.operationId,activatedAt:stamp,updatedAt:stamp};
   const nextSlots={...slots,revision:slots.revision+1,activeDevices:[...slots.activeDevices,{uid:actor.uid,deviceId:body.deviceId}],updatedAt:stamp};
   tx.set(bindingPath(actor.uid),next);
   tx.set(slotsPath(body.staffId),nextSlots);
   tx.set(credentialPath(body.staffId),{...current,deviceSlotsRevision:nextSlots.revision,deviceSlotsHash:sha(canonical(nextSlots))});
   tx.set(indexPath(body.deviceId),{protocolVersion:1,uid:actor.uid,staffId:body.staffId,deviceId:body.deviceId,createdAt:stamp});
   tx.set(mirrorPath(body.deviceId),{deviceId:body.deviceId,deviceName:body.deviceName.trim()+' (Staff)',branch:device.branch,status:'Active',appType:'Staff',setupVersion:1,setupUid:actor.uid,staffId:body.staffId,staffName:device.staffName,registeredAt:new Date(stamp),lastActive:new Date(stamp)});
   const result={enabled:cfg.enabled,mode:'protected',device};saveOperation(tx,'/activate',body,actor,result,stamp,current.verifier,{staffId:body.staffId,deviceId:body.deviceId,status:'Active',activeDevices:slots.activeDevices.length+1,deviceLimit:MAX_ACTIVE_DEVICES});return result;
  });
 }
 async function deviceStatus(body,actor) {
  return store.transaction(async tx=>{
   const [config,index,mirror,own]=await Promise.all([tx.get(configPath),tx.get(indexPath(body.deviceId)),tx.get(mirrorPath(body.deviceId)),tx.get(bindingPath(actor.uid))]);const cfg=configOf(config);
   let binding;
   if(owner(actor)&&index&&id(index.uid))binding=bindingOf(await tx.get(bindingPath(index.uid)),index.uid);else binding=bindingOf(own,actor.uid);
   if(binding){if(binding.deviceId!==body.deviceId)unavailable();const [profile,savedCredential,savedSlots]=await Promise.all([tx.get('cashiers/'+binding.staffId),tx.get(credentialPath(binding.staffId)),tx.get(slotsPath(binding.staffId))]),credential=credentialOf(savedCredential,binding.staffId),slots=await readSlots(tx,binding.staffId,savedSlots,credential);assertBindingSlot(slots,binding);return {enabled:cfg.enabled,mode:'protected',device:protectedDevice(binding,index,mirror,profile)};}
   if(index||reservedMirror(mirror))unavailable();
   if(cfg.enabled)return {enabled:true,mode:'protected',device:null};
   // Only the separate legacy listener may interpret an unprotected mirror.
   // This endpoint never elevates a public legacy device into protected access.
   return {enabled:false,mode:'legacy',device:null};
  });
 }
 async function deviceAction(body,actor) {
  return store.transaction(async tx=>{
   const [prior,index,mirror]=await Promise.all([readPrior(tx,body.operationId),tx.get(indexPath(body.deviceId)),tx.get(mirrorPath(body.deviceId))]),retry=await priorResult(prior,'/device-action',body,actor);
   if(!index||!id(index.uid))fail(404,'protected-device-missing','This phone is not registered through personal setup codes.');
   const binding=bindingOf(await tx.get(bindingPath(index.uid)),index.uid);if(!binding||binding.deviceId!==body.deviceId||!validIndex(index,binding))unavailable();
   const [profile,savedCredential,savedSlots]=await Promise.all([tx.get('cashiers/'+binding.staffId),tx.get(credentialPath(binding.staffId)),tx.get(slotsPath(binding.staffId))]),credential=credentialOf(savedCredential,binding.staffId),slots=await readSlots(tx,binding.staffId,savedSlots,credential);assertBindingSlot(slots,binding);
   if(retry){if(binding.lastOperationId!==body.operationId||binding.status!==retry.status||protectedDevice(binding,index,mirror,profile).status!==retry.status)changed();return retry;}
   if(binding.status==='Deleted'&&body.action!=='delete')fail(409,'device-deleted','This phone registration was deleted. Set it up with a new device ID.');
   if(binding.status!=='Deleted'&&!matchesMirror(binding,mirror))unavailable();
   if(body.action==='unblock'&&(!activeSetupStaff(profile)||profile.branch.trim()!==binding.branch))fail(409,'staff-unavailable','Review the staff account and assigned branch before unblocking this phone.');
   const stamp=new Date(time()).toISOString(),status=body.action==='delete'?'Deleted':body.action==='block'?'Blocked':'Active';
   if(status==='Active'&&binding.status!=='Active'&&slots.activeDevices.length>=MAX_ACTIVE_DEVICES)deviceLimit();
   const activeDevices=slots.activeDevices.filter(item=>item.uid!==binding.uid);if(status==='Active')activeDevices.push({uid:binding.uid,deviceId:binding.deviceId});
   const result={deviceId:body.deviceId,status,staffId:binding.staffId,staffName:binding.staffName,branch:binding.branch};
   tx.set(bindingPath(index.uid),{...binding,status,recordVersion:(binding.recordVersion??1)+1,lastOperationId:body.operationId,updatedAt:stamp,updatedByUid:actor.uid});
   if(canonical(activeDevices)!==canonical(slots.activeDevices)){
    const nextSlots={...slots,revision:slots.revision+1,activeDevices,updatedAt:stamp};
    tx.set(slotsPath(binding.staffId),nextSlots);tx.set(credentialPath(binding.staffId),{...credential,deviceSlotsRevision:nextSlots.revision,deviceSlotsHash:sha(canonical(nextSlots))});
   }
   if(body.action==='delete')tx.delete(mirrorPath(body.deviceId));else tx.set(mirrorPath(body.deviceId),{...mirror,status,lastActive:new Date(stamp)});
   // The immutable device-to-UID index is never deleted or reassigned.
   saveOperation(tx,'/device-action',body,actor,result,stamp,null,{staffId:binding.staffId,deviceId:body.deviceId,action:body.action,status,activeDevices:activeDevices.length,deviceLimit:MAX_ACTIVE_DEVICES});return result;
  });
 }
 return async request=>{
  const headers={'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Content-Type':'application/json; charset=utf-8','Vary':'Origin'};
  try {
   if(!origins.has(request?.origin))fail(403,'origin-denied','This request is not from an approved app.');
   headers['Access-Control-Allow-Origin']=request.origin;
   if(request.method==='OPTIONS'){
    if(request.preflightMethod!=='POST'||String(request.preflightHeaders??'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean).some(v=>!['authorization','content-type'].includes(v)))fail(403,'preflight-denied','This request is not supported.');
    return {status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'},body:null};
   }
   if(request.method!=='POST')fail(405,'method-not-allowed','Use a supported setup request.');
   if(!routes.has(request.path))fail(404,'route-not-found','This setup request is unavailable.');
   if(!object(request.query??{})||Object.keys(request.query??{}).length)fail(400,'invalid-request','Setup requests cannot use query parameters.');
   if(typeof request.contentType!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.contentType))fail(415,'content-type','Use a JSON setup request.');
   const rawSize=request.rawSize??Buffer.byteLength(JSON.stringify(request.body)??'');
   if(!Number.isSafeInteger(rawSize)||rawSize<0||rawSize>MAX_REQUEST_BYTES||Buffer.byteLength(JSON.stringify(request.body)??'')>MAX_REQUEST_BYTES)fail(413,'request-too-large','The setup request is too large.');
   const body=bodyFor(request.path,request.body),actor=await auth(request,request.path!=='/config');
   if(ownerRoutes.has(request.path)&&(!owner(actor)||request.origin!==PRODUCTION_ORIGINS[1]))fail(403,'owner-required','The verified Owner account is required.');
   if(request.path==='/activate'&&request.origin!==PRODUCTION_ORIGINS[0])fail(403,'staff-origin-required','Use the Staff app to set up this phone.');
   if(request.path==='/device-status'&&!owner(actor)&&actor.firebase.sign_in_provider!=='anonymous')fail(403,'staff-auth-required','Use the Staff app to check this phone.');
   let result;
   switch(request.path){
    case '/config':result=await configuration();break;
    case '/policy':result=await policy(body,actor);break;
    case '/code-status':result=await codeStatus(body);break;
    case '/issue-code':case '/disable-code':result=await manageCode(request.path,body,actor);break;
    case '/activate':result=await activate(body,actor,request.trustedIP);break;
    case '/device-status':result=await deviceStatus(body,actor);break;
    case '/device-action':result=await deviceAction(body,actor);break;
   }
   return {status:200,headers,body:result};
  }catch(error){return {status:error instanceof SetupError?error.status:503,headers,body:{error:{code:error instanceof SetupError?error.kind:'service-unavailable',message:error instanceof SetupError?error.message:'Staff setup is temporarily unavailable. Check your connection and retry the same request.'}}};}
 };
}
