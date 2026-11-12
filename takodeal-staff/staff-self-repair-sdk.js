import {createStaffSetupTransport,validateSetupStatus,normalizeSetupCode,freshSetupId} from './staff-setup-access.js';

export const STAFF_REPAIR_CANDIDATE_APP='takodeal-staff-self-repair-candidate-v1';
const CANDIDATE='takodeal_staff_self_repair_candidate_v1',JOURNAL='takodeal_staff_self_repair_v1';
const exact=(row,keys)=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')===[...keys].sort().join(',');
const id=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,128}$/.test(value),device=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,50}$/.test(value);
const candidateFields=['schemaVersion','primaryUid','staffId','uid','deviceId','operationId','previousUid'];

// SDK primitives are supplied from the one existing app's exact SDK version.
// No candidate app, Auth session, private client or network call is created here.
export function createStaffSelfRepairSDK({app,auth,db,config,sdk,readPrivateClient=()=>null,window:w=window,storage=w.localStorage,navigator:nav=w.navigator,fetcher=w.fetch?.bind(w)}){
 if(auth?.app!==app||db?.app!==app||app?.options?.projectId!==config?.projectId||app?.options?.apiKey!==config?.apiKey)throw Error('Staff repair must use this app’s existing primary connection.');
 for(const method of ['getApps','initializeApp','getAuth','setPersistence','signInAnonymously','updateCurrentUser','waitForPendingWrites'])if(typeof sdk?.[method]!=='function')throw Error('Staff repair support is incomplete. Refresh app files first.');
 let candidateFlight=null,candidateAuth=null;
 function journal(){try{return JSON.parse(storage.getItem(JOURNAL)||'null');}catch{throw Error('Keep the saved reset reference and ask the Owner for help.');}}
 function capture(){
  const privateClient=readPrivateClient(),row=journal(),uid=auth.currentUser?.uid;
  if(auth.currentUser&&auth.currentUser.isAnonymous!==true)throw Error('This is not a normal Staff phone sign-in. Its existing account has been kept; ask the Owner for help.');
  let staffId=storage.getItem('takodeal_staff_id'),deviceId=storage.getItem('takodeal_device_id');
  if(row&&['handoff-pending','complete'].includes(row.phase)&&row.candidateUid===uid){if(staffId===null&&id(row.staffId))staffId=row.staffId;if(deviceId===null&&device(row.deviceId))deviceId=row.deviceId;}
  // A second explicit reset can start before the usual login selection is
  // restored. Its exact persisted candidate links the new journal to the same
  // currently held primary UID/device; a different selected staff never falls
  // back to this metadata.
  if(staffId===null&&row?.primaryUid===uid&&row.deviceId===deviceId){const prepared=readCandidate();if(prepared&&prepared.primaryUid===uid&&prepared.staffId===row.staffId&&prepared.uid===row.candidateUid&&prepared.deviceId===row.candidateDeviceId&&prepared.operationId===row.operationId)staffId=row.staffId;}
  return {primaryUid:uid||null,privateUid:privateClient?.auth?.currentUser?.uid||null,staffId,deviceId};
 }
 function readCandidate(){
  let row;try{row=JSON.parse(storage.getItem(CANDIDATE)||'null');}catch{throw Error('The saved replacement phone reference needs Owner review.');}
  if(row&&(!exact(row,candidateFields)||row.schemaVersion!==1||!id(row.primaryUid)||!id(row.staffId)||!(row.uid===null||id(row.uid))||!(row.previousUid===null||id(row.previousUid))||!device(row.deviceId)||!id(row.operationId)))throw Error('The saved replacement phone reference needs Owner review.');
  return row;
 }
 function saveCandidate(row){const text=JSON.stringify(row);storage.setItem(CANDIDATE,text);if(storage.getItem(CANDIDATE)!==text)throw Error('The replacement reference could not be saved. Your current sign-in is kept.');return row;}
 async function existingCandidate(assertCurrent){
  assertCurrent();
  if(!candidateAuth){let candidateApp=sdk.getApps().find(value=>value.name===STAFF_REPAIR_CANDIDATE_APP);if(!candidateApp)candidateApp=sdk.initializeApp(config,STAFF_REPAIR_CANDIDATE_APP);if(candidateApp===app||candidateApp.options.projectId!==config.projectId||candidateApp.options.apiKey!==config.apiKey)throw Error('The replacement connection does not match the Staff app.');candidateAuth=sdk.getAuth(candidateApp);if(candidateAuth===auth||candidateAuth===readPrivateClient()?.auth||candidateAuth.app!==candidateApp)throw Error('The replacement sign-in is not separate from this phone.');}
  await candidateAuth.authStateReady();assertCurrent();return candidateAuth;
 }
 function checkJournal(row){if(!row||!id(row.staffId)||!id(row.candidateUid)||!device(row.candidateDeviceId)||!id(row.operationId)||row.candidateUid===row.primaryUid||row.candidateDeviceId===row.deviceId)throw Error('Keep the original reset reference. The replacement identity does not match.');}
 async function candidateFor(row,assertCurrent){checkJournal(row);const candidate=await existingCandidate(assertCurrent);assertCurrent();if(candidate.currentUser?.uid!==row.candidateUid||candidate.currentUser.isAnonymous!==true)throw Error('The saved replacement sign-in is unavailable. Your current sign-in is kept.');const prepared=readCandidate();if(!prepared||prepared.uid!==row.candidateUid||prepared.deviceId!==row.candidateDeviceId||prepared.operationId!==row.operationId||prepared.staffId!==row.staffId||prepared.primaryUid!==row.primaryUid)throw Error('The saved replacement phone reference changed. Keep the original reset reference.');return candidate;}
 async function createCandidate({staffId,assertCurrent}){
  assertCurrent();if(!id(staffId)||capture().staffId!==staffId)throw Error('Reset only the currently selected staff account.');
  if(candidateFlight)return candidateFlight.then(value=>{assertCurrent();return value;});
  let physical;physical=(async()=>{
   const primaryUid=auth.currentUser?.uid;if(!id(primaryUid))throw Error('Reconnect the existing Staff phone before resetting.');
   const candidate=await existingCandidate(assertCurrent);assertCurrent();let row=readCandidate();
   if(row&&(row.primaryUid!==primaryUid||row.staffId!==staffId)){
    const done=journal();if(!done||done.phase!=='complete'||done.candidateUid!==primaryUid||row.uid!==primaryUid||done.operationId!==row.operationId||candidate.currentUser?.uid!==primaryUid)throw Error('An earlier replacement belongs to another phone context. Keep its saved reference.');
    // Persist the next exact DEV/op before rotating only replacement Auth.
    // A crash after that Auth becomes null must resume this same preparation.
    row=saveCandidate({schemaVersion:1,primaryUid,staffId,uid:null,deviceId:'DEV-'+freshSetupId(w.crypto).toUpperCase(),operationId:freshSetupId(w.crypto),previousUid:primaryUid});
   }
   if(!row)row=saveCandidate({schemaVersion:1,primaryUid,staffId,uid:null,deviceId:'DEV-'+freshSetupId(w.crypto).toUpperCase(),operationId:freshSetupId(w.crypto),previousUid:null});
   if(row.primaryUid!==primaryUid||row.staffId!==staffId)throw Error('The replacement staff account changed.');
   if(row.previousUid&&candidate.currentUser?.uid===row.previousUid){const done=journal();if(row.uid!==null||row.previousUid!==primaryUid||!done||done.phase!=='complete'||done.candidateUid!==primaryUid||done.staffId!==staffId)throw Error('The previous replacement handoff needs review.');await sdk.updateCurrentUser(candidate,null);assertCurrent();if(candidate.currentUser!==null)throw Error('The replacement sign-in could not be prepared safely.');}
   if(!candidate.currentUser){await sdk.setPersistence(candidate,sdk.browserLocalPersistence);assertCurrent();await sdk.signInAnonymously(candidate);assertCurrent();}
   const user=candidate.currentUser;if(!id(user?.uid)||user.isAnonymous!==true||user.uid===primaryUid||row.uid&&row.uid!==user.uid)throw Error('The replacement identity could not be confirmed safely.');
   row=saveCandidate({...row,uid:user.uid});assertCurrent();return {uid:row.uid,deviceId:row.deviceId,operationId:row.operationId};
  })().finally(()=>{if(candidateFlight===physical)candidateFlight=null;});candidateFlight=physical;return physical;
 }
 async function transport(row,assertCurrent){
  const candidate=await candidateFor(row,assertCurrent),user=candidate.currentUser;
  return createStaffSetupTransport({auth:candidate,ensureUser:async()=>{assertCurrent();if(candidate.currentUser!==user)throw Error('The replacement sign-in changed.');return user;},fetcher:async(...args)=>{assertCurrent();const response=await fetcher(...args);assertCurrent();return response;}});
 }
 async function verifyCandidate({journal:row,assertCurrent}){
  const setup=await transport(row,assertCurrent),data=await setup.call('/device-status',{deviceId:row.candidateDeviceId});assertCurrent();const result=validateSetupStatus(data,row.candidateDeviceId);
  if(result.mode==='protected'&&result.device){if(result.device.status!=='Active'||result.device.staffId!==row.staffId)throw Error('The replacement is paused or belongs to a different staff account. Your existing sign-in is kept.');return {active:true,uid:row.candidateUid,deviceId:row.candidateDeviceId,staffId:row.staffId};}
  return {active:false,uid:row.candidateUid,deviceId:row.candidateDeviceId,staffId:row.staffId};
 }
 async function activateCandidate({journal:row,code,assertCurrent}){
  const setup=await transport(row,assertCurrent),normalized=normalizeSetupCode(code);assertCurrent();
  await setup.call('/activate',{deviceId:row.candidateDeviceId,deviceName:'Staff personal-code recovery',staffId:row.staffId,operationId:row.operationId,code:normalized});assertCurrent();return verifyCandidate({journal:row,assertCurrent});
 }
 async function drainPendingWrites({assertCurrent}){
  assertCurrent();const privateClient=readPrivateClient(),targets=[db,...(privateClient?.db&&privateClient.db!==db?[privateClient.db]:[])];
  if(privateClient&&(privateClient.auth===auth||privateClient.db===db))throw Error('The private connection must remain separate.');
  await Promise.all(targets.map(value=>sdk.waitForPendingWrites(value)));assertCurrent();
 }
 async function assertSingleWindow({assertCurrent}){
  assertCurrent();const base=new URL('./',w.location.href),registration=await nav.serviceWorker?.getRegistration(base.href);assertCurrent();const worker=registration?.active;
  if(!worker||nav.serviceWorker.controller!==worker||registration.scope!==base.href||worker.scriptURL!==new URL('sw.js',base).href||typeof w.MessageChannel!=='function')throw Error('Refresh app files, then close every other Staff window before resetting sign-in.');
  return new Promise((resolve,reject)=>{const channel=new w.MessageChannel();let settled=false;const finish=(error,value)=>{if(settled)return;settled=true;w.clearTimeout(timer);channel.port1.close();channel.port2.close();if(error)reject(error);else resolve(value);};const timer=w.setTimeout(()=>finish(Error('The Staff window check was not confirmed. Refresh app files first.')),4000);channel.port1.onmessage=event=>{try{assertCurrent();if(nav.serviceWorker.controller!==worker||!exact(event.data,['schemaVersion','singleWindow','windows'])||event.data.schemaVersion!==1||!Number.isSafeInteger(event.data.windows)||event.data.windows<0||event.data.singleWindow!==(event.data.windows===1))throw Error('The Staff window check changed. Close other Staff windows and try again.');finish(null,event.data.singleWindow);}catch(error){finish(error);}};channel.port1.onmessageerror=()=>finish(Error('The Staff window check could not be confirmed.'));try{worker.postMessage({type:'TAKODEAL_STAFF_SINGLE_WINDOW'},[channel.port2]);}catch(error){finish(error);}});
 }
 async function handoffPrimary({journal:row,assertCurrent}){
  checkJournal(row);if(row.phase!=='handoff-pending')throw Error('Save the confirmed handoff reference before switching sign-in.');
  const candidate=await candidateFor(row,assertCurrent),privateBefore=readPrivateClient()?.auth?.currentUser||null;
  const active=await verifyCandidate({journal:row,assertCurrent});assertCurrent();if(active.active!==true)throw Error('The personal code has not confirmed this replacement.');
  await drainPendingWrites({assertCurrent});if(await assertSingleWindow({assertCurrent})!==true)throw Error('Close every other Staff window before finishing reset.');assertCurrent();
  if(auth.currentUser?.uid!==row.candidateUid){if(auth.currentUser?.uid!==row.primaryUid)throw Error('The original Staff sign-in changed.');await sdk.updateCurrentUser(auth,candidate.currentUser);}
  // This physical mutation has no cancellation/timeout. The durable core keeps
  // handoff-pending and its single-flight lock until the SDK actually settles.
  assertCurrent();if(auth.currentUser?.uid!==row.candidateUid||(readPrivateClient()?.auth?.currentUser||null)!==privateBefore)throw Error('The Staff sign-in handoff could not be confirmed. Keep its saved reset reference.');
 }
 return {capture,createCandidate,activateCandidate,verifyCandidate,drainPendingWrites,assertSingleWindow,handoffPrimary};
}
