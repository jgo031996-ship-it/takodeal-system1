import {createHash,scrypt as derive} from 'node:crypto';
import {promisify} from 'node:util';
import {isAccessOwner,activeAccessStaff,operationalStaffProfile} from './access-model.mjs';
import {profileId,profileDevice,profileError,profileHash} from './staff-private-profile-model.mjs';
import {readPrivateStaffPhone} from './personal-vault-phone.mjs';
import {exactDailyPin,pinProof,matchesPinProof} from './staff-session.mjs';
import {identityPatch,employeeNames,normalizeName} from './staff-identity.mjs';
import {CONTRACT_VERSION,PREVIOUS_CONTRACT_VERSION,LEGACY_CONTRACT_VERSION,initialContract} from './employment-contract.mjs';
const scrypt=promisify(derive),hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const fail=(message,status=400)=>{throw profileError(status,'signup',message);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const secret=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const invitePath=id=>'staff_access_operations/hire-invite-'+id;
const contractPath=id=>'staff_access_operations/hire-contract-'+id;
const allowed=['cashierName','scheduleNickname','phone','address','email','emergencyName','emergencyPhone','gcashName','gcashNum','gotymeName','gotymeNum','sss','philhealth','pagibig'];
export function validateHireDetails(value){
 if(!exact(value,allowed))fail('Complete the employee form before signing.');
 for(const [key,v] of Object.entries(value))if(typeof v!=='string'||v!==v.trim()||v.length>(key==='address'?2000:160)||/[\u0000-\u001f\u007f]/.test(v))fail('Check the employee details.');
 if(value.cashierName.length<2||!value.scheduleNickname||!value.address||!value.emergencyName||!/^\+?[\d ()-]{7,20}$/.test(value.phone)||!/^\+?[\d ()-]{7,20}$/.test(value.emergencyPhone)||value.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))fail('Enter your full name, nickname, phone, address and emergency contact.');
 return value;
}
function signature(value){if(typeof value!=='string'||value.length>100000||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value))fail('Draw your signature before signing.');const data=Buffer.from(value.split(',')[1],'base64');if(data.length<200||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.length<24||data.readUInt32BE(16)>2000||data.readUInt32BE(20)>1000)fail('Draw your signature in the signature box.');}
export function createStaffHiringStore(db,{now=Date.now,serverTimestamp}={}){
 const read=(tx,path)=>tx.get(db.doc(path));
 async function owner(tx,actor){if(!isAccessOwner(actor))fail('Sign in with the Owner account.',403);const records=await tx.get(db.collection('hq_managers').where('email','==',actor.email).limit(3));if(records.docs.length!==1||records.docs[0].data().active===false||records.docs[0].data().blocked===true||/archived|disabled|inactive|revoked/i.test(records.docs[0].data().status||''))fail('Confirm the active Owner account.',403);}
 async function offer(tx,branch){const records=await tx.get(db.collection('branches').where('name','==',branch).limit(3));if(records.docs.length!==1||records.docs[0].data().active===false||records.docs[0].data().archived===true)fail('Choose an active branch.');}
 function inviteInput(input){if(!profileId(input?.inviteId)||!secret(input.token))fail('Open the complete hiring link from the Owner.',403);}
 function usable(snap,input){const row=snap.exists?snap.data():null;if(row?.kind!=='staff-hire-invite-v1'||row.tokenHash!==hash(input.token)||row.revoked||row.expiresAt<=now())fail('This hiring link is expired or unavailable. Request a new link from the Owner.',403);return row;}
 return{
  async create(input,actor){if(!exact(input,['inviteId','token','branch','role','dateHired','dailyRate'])||!profileId(input.inviteId)||!secret(input.token)||!['Crew','Cashier'].includes(input.role)||!date(input.dateHired)||typeof input.dailyRate!=='number'||!Number.isFinite(input.dailyRate)||input.dailyRate<=0||input.dailyRate>100000||typeof input.branch!=='string')fail('Choose the branch, job, start date and agreed daily rate.');return db.runTransaction(async tx=>{await owner(tx,actor);await offer(tx,input.branch);const ref=db.doc(invitePath(input.inviteId)),existing=await tx.get(ref),intent=profileHash(input);if(existing.exists){if(existing.data().intent!==intent||existing.data().createdByUid!==actor.uid)fail('Start a new hiring link.',409);return{inviteId:input.inviteId,expiresAt:existing.data().expiresAt};}const expiresAt=now()+7*86400000;tx.create(ref,{kind:'staff-hire-invite-v1',tokenHash:hash(input.token),intent,offer:{branch:input.branch,role:input.role,dateHired:input.dateHired,dailyRate:input.dailyRate},contractVersion:CONTRACT_VERSION,createdByUid:actor.uid,createdAt:new Date(now()).toISOString(),expiresAt,used:false,revoked:false});return{inviteId:input.inviteId,expiresAt};});},
  async preview(input,actor){inviteInput(input);if(actor?.firebase?.sign_in_provider!=='anonymous')fail('Open this hiring link in the Staff app.',403);return db.runTransaction(async tx=>{const row=usable(await read(tx,invitePath(input.inviteId)),input);if(row.used)fail('This hiring link has already been completed.',409);await offer(tx,row.offer.branch);return{offer:row.offer,contractVersion:CONTRACT_VERSION,expiresAt:row.expiresAt};});},
  async submit(input,actor){
   if(!exact(input,['inviteId','token','deviceId','operationId','details','dailyPin','setupCode','signature','contractVersion','accepted'])||!profileId(actor?.uid)||actor.firebase?.sign_in_provider!=='anonymous'||!profileId(input.operationId)||!profileDevice(input.deviceId)||!/^\d{4,10}$/.test(input.dailyPin||'')||!/^\d{10}$/.test(input.setupCode||'')||input.accepted!==true||![CONTRACT_VERSION,PREVIOUS_CONTRACT_VERSION,LEGACY_CONTRACT_VERSION].includes(input.contractVersion))fail('Complete the signup form and agree to the displayed employment contract.');
   inviteInput(input);const details=validateHireDetails(input.details);signature(input.signature);
   const intent=profileHash({details,signature:input.signature,deviceId:input.deviceId,operationId:input.operationId,contractVersion:input.contractVersion}),credentialSalt=hash(input.token+'setup-salt').slice(0,32),credentialHash=(await scrypt(input.setupCode,Buffer.from(credentialSalt,'hex'),32,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex'),dailyProof=await pinProof(input.dailyPin);
   return db.runTransaction(async tx=>{
    const inviteRef=db.doc(invitePath(input.inviteId)),saved=await tx.get(inviteRef),invitation=usable(saved,input),staffId='hire-'+input.inviteId;
    if(invitation.used){if(invitation.uid!==actor.uid||invitation.intentAtSigning!==intent||!await matchesPinProof(input.dailyPin,invitation.dailyProof)||invitation.setupProof!==credentialHash)fail('This link was already completed. Sign in to the saved account.',409);return{staffId,deviceId:input.deviceId,saved:true,alreadySaved:true};}
    if(input.contractVersion!==CONTRACT_VERSION)fail('The employment contract was updated. Reload this signup page and review the new agreement before signing.',409);
    await offer(tx,invitation.offer.branch);
    const [existing,binding,device,index,config,people]=await Promise.all([read(tx,'cashiers/'+staffId),read(tx,'staff_app_bindings/'+actor.uid),read(tx,'pos_devices/'+input.deviceId),read(tx,'staff_app_device_index/'+input.deviceId),read(tx,'staff_app_setup_config/current'),tx.get(db.collection('cashiers').limit(2001).select('cashierName','fullName','name','scheduleNickname','scheduleName','nickname','scheduleAliases','pin'))]);
    if(existing.exists||binding.exists||device.exists||index.exists)fail('This phone is already linked to an employee. Use the new hire’s own phone.',409);
    if(people.docs.length>2000)fail('The staff directory needs review.',409);
    if(people.docs.some(row=>exactDailyPin(row.data().pin,input.dailyPin)))fail('Choose a different daily PIN; this one is already in use.',409);
    const names=identityPatch({},details,people.docs.map(row=>row.data())),stamp=new Date(now()).toISOString(),day=new Date(now()+8*3600000).toISOString().slice(0,10),job=invitation.offer;
    const profile={...names,...job,active:true,status:'Active',loginPinVersion:0,pin:input.dailyPin,hourlyRate:job.dailyRate,contractStatus:'Active',signedContracts:{initial:day},signupContractId:staffId,createdAt:stamp,onboardingSource:'employee-signup',createdByInvite:input.inviteId};
    const slots={protocolVersion:1,staffId,revision:1,activeDevices:[{uid:actor.uid,deviceId:input.deviceId}],createdAt:stamp,updatedAt:stamp};
    const registration={protocolVersion:1,uid:actor.uid,staffId,staffName:profile.cashierName,branch:job.branch,deviceId:input.deviceId,status:'Active',deviceName:'Personal phone',codeVersion:1,recordVersion:1,lastOperationId:input.operationId,activatedAt:stamp,updatedAt:stamp};
    const html=initialContract(job,{cashierName:profile.cashierName,address:details.address,signature:input.signature,signedAt:stamp});
    tx.create(db.doc('cashiers/'+staffId),profile);tx.set(db.doc('staff_directory/'+staffId),operationalStaffProfile(staffId,profile));
    tx.create(db.doc(contractPath(staffId)),{kind:'signed-employment-contract-v1',staffId,contractVersion:CONTRACT_VERSION,offer:job,signerName:profile.cashierName,signedAt:stamp,signature:input.signature,html,sha256:hash(html),uid:actor.uid,deviceId:input.deviceId,accepted:true});
    tx.create(db.doc('staff_setup_credentials/'+staffId),{protocolVersion:1,deviceSlotsVersion:1,deviceSlotsRevision:1,deviceSlotsHash:hash(canonical(slots)),staffId,enabled:true,version:1,issuedAt:stamp,updatedAt:stamp,updatedByUid:invitation.createdByUid,verifier:{algorithm:'scrypt-v1',N:16384,r:8,p:1,salt:credentialSalt,hash:credentialHash}});
    tx.create(db.doc('staff_setup_device_slots/'+staffId),slots);tx.create(db.doc('staff_app_bindings/'+actor.uid),registration);tx.create(db.doc('staff_app_device_index/'+input.deviceId),{protocolVersion:1,uid:actor.uid,staffId,deviceId:input.deviceId,createdAt:stamp});
    tx.create(db.doc('pos_devices/'+input.deviceId),{deviceId:input.deviceId,deviceName:'Personal phone (Staff)',branch:job.branch,status:'Active',appType:'Staff',setupVersion:1,setupUid:actor.uid,staffId,staffName:profile.cashierName,registeredAt:new Date(stamp),lastActive:new Date(stamp)});
    if(!config.exists)tx.create(db.doc('staff_app_setup_config/current'),{protocolVersion:1,enabled:false,revision:0});
    tx.create(db.doc('manager_alerts/hire-signup-'+staffId),{type:'STAFF_SIGNUP',branch:job.branch,staffId,staffName:profile.cashierName,cashier:profile.cashierName,message:'New employee signup completed: '+profile.cashierName+' ('+job.branch+'). The signed contract is saved and the personal phone is active. Review the employee profile in Staff & Security; login does not wait for approval.',isRead:false,timestamp:new Date(stamp)});
    tx.update(inviteRef,{used:true,staffId,uid:actor.uid,intentAtSigning:intent,dailyProof,setupProof:credentialHash,signedAt:stamp});
    return{staffId,deviceId:input.deviceId,saved:true,alreadySaved:false};
   });
  },
  async contract(input,actor){if(!profileId(input?.staffId))fail('Select a saved employee contract.');return db.runTransaction(async tx=>{if(isAccessOwner(actor))await owner(tx,actor);else{if(actor?.firebase?.sign_in_provider!=='anonymous')fail('Sign in to view your contract.',403);await readPrivateStaffPhone(tx,db,{uid:actor.uid,staffId:input.staffId,deviceId:input.deviceId},()=>fail('Confirm your Staff profile to view this contract.',403));}const snap=await read(tx,contractPath(input.staffId));if(!snap.exists)return{found:false};const saved=snap.data();if(saved.staffId!==input.staffId||hash(saved.html)!==saved.sha256)fail('The saved contract could not be verified.',409);const profile=await read(tx,'cashiers/'+input.staffId);const currentHtml=initialContract(saved.offer,{cashierName:saved.signerName,address:profile.exists?profile.data().address:''});return{found:true,staffId:saved.staffId,html:saved.html,sha256:saved.sha256,signedAt:saved.signedAt,contractVersion:saved.contractVersion,currentContractVersion:CONTRACT_VERSION,currentHtml};});}
 };
}
