import {buildOnboardingState,onboardingDay} from './onboarding-model.js';
import {dailyStaffRate,staffRateForDate} from './staff-rate-model.js';
const deadline=(promise,ms,message)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>clearTimeout(timer));};
const confirmed=snapshot=>{if(snapshot?.metadata?.fromCache||snapshot?.metadata?.hasPendingWrites)throw Error('Reconnect to HQ to confirm your employee record.');return snapshot;};
export function createStaffOnboardingService(api,{createVault,now=()=>Date.now(),cacheMs=300000,readAttendance}={}){
 let epoch=0,cache=null,flight=null,vaultPromise=null,privateClient=null;
 const identity=()=>api.localStorage.getItem('takodeal_staff_id'),uid=()=>privateClient?.auth?.currentUser?.uid||null;
 function reset(){epoch++;cache=null;flight=null;}
 const vault=()=>vaultPromise||(vaultPromise=Promise.resolve().then(createVault).then(client=>{privateClient=client;return client;}).catch(error=>{vaultPromise=null;throw error;}));
 async function load({force=false}={}){
  const staffId=identity();if(!staffId||staffId.includes('/'))throw Error('Sign in to your own Staff profile.');
  if(!force&&cache?.staffId===staffId&&cache.uid===uid()&&now()-cache.savedAt<cacheMs)return cache.state;
  if(flight?.staffId===staffId)return flight.promise;
  const token=++epoch,current=()=>token===epoch&&identity()===staffId;
  const work=(async()=>{
   const profileWork=deadline(api.getDocFromServer(api.doc(api.db,'cashiers',staffId)),20000,'Your employee profile could not be confirmed. Reconnect and refresh.').then(confirmed);
   // Read complete ID AND name metadata. Earlier name-only legacy punches
   // must prevent treating the employee-ID rollout as somebody's first day.
   const attendanceWork=profileWork.then(async profileSnap=>{
    if(!profileSnap.exists())throw Error('The employee profile is unavailable.');
    const staffName=profileSnap.data().cashierName;
    if(typeof staffName!=='string'||!staffName.trim())throw Error('HR must confirm the saved employee name.');
    if(typeof readAttendance==='function'){
     const result=await readAttendance({staffId,staffName});
     if(!result||result.complete!==true||!Array.isArray(result.rows))throw Error('The complete first-work history needs a confirmed HQ read.');
     return result.rows;
    }
    const base=api.collection(api.db,'attendance_logs'),queries=[api.query(base,api.where('staffId','==',staffId)),api.query(base,api.where('staffName','==',staffName))];
    const snapshots=typeof api.readStaffMetadata==='function'?await Promise.all([api.readStaffMetadata({table:'attendance_logs',field:'staffId',value:staffId}),api.readStaffMetadata({table:'attendance_logs',field:'staffName',value:staffName})]):await Promise.all(queries.map(query=>api.getDocsFromServer(query))),rows=new Map();
    for(const snapshot of snapshots){confirmed(snapshot);if(!Array.isArray(snapshot.docs)||snapshot.docs.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('The complete first-work history needs a confirmed HQ read.');for(const doc of snapshot.docs){const row={...doc.data(),id:doc.id};if(row.staffId===staffId||!row.staffId&&row.staffName===staffName)rows.set(doc.id,row);}}
    return [...rows.values()];
   });
   const checkedAttendance=deadline(attendanceWork,25000,'The complete first-work history could not be confirmed. Reconnect and refresh.');
   const documentsWork=deadline((async()=>{const client=await vault();if(!current())return null;const privateUid=client.auth?.currentUser?.uid||null;if(!privateUid)throw Error('Use your approved Staff phone to check private documents.');const records=await client.store.records();if(!current()||uid()!==privateUid)return null;return {records,uid:privateUid};})(),15000,'Private document status could not be confirmed.').catch(()=>null);
   const [profileResult,attendanceResult,documentResult]=await Promise.allSettled([profileWork,checkedAttendance,documentsWork]);if(!current())return null;
   if(profileResult.status!=='fulfilled'||!profileResult.value.exists())throw Error(profileResult.reason?.message||'Your saved employee profile could not be found. Contact HQ.');
   const profile=profileResult.value.data(),attendance=attendanceResult.status==='fulfilled'?attendanceResult.value:[],docs=documentResult.status==='fulfilled'?documentResult.value:null;
   const state=buildOnboardingState({staffId,profile,attendance,attendanceComplete:attendanceResult.status==='fulfilled',documents:docs?.records||{},documentsAvailable:!!docs&&docs.uid===uid(),today:new Date(now())});
   if(!current())return null;cache={staffId,uid:uid(),savedAt:now(),state};return state;
  })();
  flight={staffId,promise:work};try{return await work;}finally{if(flight?.promise===work)flight=null;}
 }
 return {load,reset};
}

const contractKey=type=>type==='Initial'?'initial':type==='Extension'?'extension':type==='Regularization'?'regularization':null;
export function contractOfferFingerprint(profile,type){const key=contractKey(type);return JSON.stringify([type,profile?.cashierName,profile?.branch,profile?.role,profile?.dateHired,profile?.hourlyRate,profile?.dailyRate,profile?.salaryRateVersion,profile?.salaryRateRevision,profile?.contractTerms?.[key]||null]);}
export function reviewedContractRate(profile,type,now=new Date()){
 const key=contractKey(type),start=profile?.contractTerms?.[key]?.startDate;
 return profile?.salaryRateVersion===1?staffRateForDate(profile,onboardingDay(start)||now):dailyStaffRate(profile);
}
export async function signOfferedContract(api,{staffId,type,signature,expectedFingerprint,expectedDailyRate,stillCurrent=()=>true,now=()=>new Date()}={}){
 const key=contractKey(type),pending={Initial:'Pending Initial Contract',Extension:'Pending Renewal',Regularization:'Pending Regularization'}[type],next={Initial:'Active',Extension:'Extended',Regularization:'Regular'}[type];
 if(!key||!staffId||!expectedFingerprint||!Number.isFinite(expectedDailyRate)||expectedDailyRate<0||typeof signature!=='string'||signature.length<64||signature.length>500000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(signature)||(signature.length-22)%4!==0)throw Error('Review the issued contract and draw your signature again.');
 const user=api.auth?.currentUser,uid=user?.uid;if(!uid)throw Error('Use your approved Staff phone to sign the contract.');
 const current=()=>{if(api.auth?.currentUser!==user||api.auth.currentUser.uid!==uid||!stillCurrent()||api.localStorage.getItem('takodeal_staff_id')!==staffId)throw Error('Your staff profile changed. Reopen the contract.');};current();
 return api.runTransaction(api.db,async tx=>{const ref=api.doc(api.db,'cashiers',staffId),snap=await tx.get(ref);current();if(!snap.exists())throw Error('Your employee profile is unavailable.');const profile=snap.data();
  if(contractOfferFingerprint(profile,type)!==expectedFingerprint)throw Error('The offered contract or profile details changed. Reopen the document before signing.');
  if(profile.signedContracts?.[key]&&profile.contractStatus===next)return {alreadySaved:true,profile};
  if(profile.contractStatus!==pending)throw Error('HQ has not issued this unsigned contract offer. Refresh your personal reminders.');
  let salaryProfile=profile;
  if(profile.salaryRateVersion===1){const salary=await tx.get(api.doc(api.db,'staff_salary_rates',staffId));current();if(!salary.exists()||salary.data().staffId!==staffId||salary.data().branch!==profile.branch)throw Error('The private salary history could not be confirmed. Reopen the contract.');salaryProfile={...profile,salaryRateTimeline:salary.data()};}
  const dailyRate=reviewedContractRate(salaryProfile,type,now());if(dailyRate===null||dailyRate!==expectedDailyRate)throw Error('The contract wage changed or cannot be confirmed. Review the document again before signing.');
  current();const signedOn=now().toLocaleDateString('en-US',{timeZone:'Asia/Manila',month:'long',day:'numeric',year:'numeric'}),signedContracts={...(profile.signedContracts||{}),[key]:signedOn};
  tx.update(ref,{contractStatus:next,contractSignature:signature,signedContracts});return {alreadySaved:false,signedOn,profile:{...salaryProfile,contractDailyRate:dailyRate,contractStatus:next,contractSignature:signature,signedContracts}};
 });
}
