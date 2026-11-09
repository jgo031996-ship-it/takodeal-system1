const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const denied=()=>Error('Use your approved private Staff phone and reconnect to view or save your own employee profile.');
const fields=new Set(['phone','address','email','emergencyName','emergencyNumber','emergencyPhone','emergencyContact','emergencyContactNumber','emergNum','gcashName','gcashNumber','gotymeName','gotyme','goTymeName','gotymeNumber','gotymeNum','gotymeAcc','gotymeAccount','goTymeNumber','goTymeAccount','gotymeAccountNumber','sss','sssNumber','philhealth','philhealthNumber','pagibig','pagibigNumber','scheduleNickname','profilePicUrl']);
export function createStaffPrivateProfileAccess({identity,createPrivateClient,timeoutMs=20000}={}){
 if(typeof identity!=='function'||typeof createPrivateClient!=='function')throw denied();
 async function run(staffId,assertCurrent,work){
  if(!id(staffId)||identity()!==staffId)throw denied();let expired=false,timer,client,user;
  const guard=()=>{if(expired||identity()!==staffId||user&&client.auth.currentUser!==user)throw denied();assertCurrent();};
  const action=Promise.resolve().then(async()=>{
   guard();client=await createPrivateClient({assertCurrent:guard});guard();user=client?.auth?.currentUser;
   if(!user?.uid||user.isAnonymous!==true||!client.sdk?.getDocFromServer||!client.sdk?.runTransaction)throw denied();
   const {sdk,db}=client;const [config,binding]=await Promise.all([sdk.getDocFromServer(sdk.doc(db,'staff_document_config','current')),sdk.getDocFromServer(sdk.doc(db,'staff_document_devices',user.uid))]);guard();
   const fresh=snap=>{if(!snap?.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw denied();return snap.data();};
   const policy=fresh(config),grant=fresh(binding);if(policy.enabled!==true||policy.policyVersion!==2||policy.brokerEndpoint!=='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'||grant.active!==true||grant.uid!==user.uid||grant.staffId!==staffId||typeof grant.branch!=='string'||!grant.branch.trim())throw denied();
   return work({...client,guard,grant,fresh});
  });
  try{return await Promise.race([action,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(denied());},timeoutMs);})]);}finally{clearTimeout(timer);expired=true;}
 }
 return{
  read(staffId,{assertCurrent=()=>{}}={}){return run(staffId,assertCurrent,async({sdk,db,guard,grant,fresh})=>{const snap=await sdk.getDocFromServer(sdk.doc(db,'cashiers',staffId));guard();const profile=fresh(snap);if(profile.branch!==grant.branch)throw denied();return snap;});},
  update(staffId,patch,{assertCurrent=()=>{},allowPayslipPin=false}={}){
   if(!patch||typeof patch!=='object'||Array.isArray(patch)||!Object.keys(patch).length||Object.keys(patch).some(key=>!fields.has(key)&&!(allowPayslipPin&&key==='payslipPin')))throw denied();
   for(const [key,value]of Object.entries(patch))if(key!=='payslipPin'&&(typeof value!=='string'||value.length>(key==='profilePicUrl'?250000:2000)))throw denied();
   return run(staffId,assertCurrent,async({sdk,db,guard,grant,fresh})=>sdk.runTransaction(db,async tx=>{
    guard();const ref=sdk.doc(db,'cashiers',staffId),snap=await tx.get(ref);guard();const profile=fresh(snap);if(profile.branch!==grant.branch||Object.hasOwn(patch,'payslipPin')&&profile.payslipPinManaged===true)throw denied();
    tx.update(ref,patch);return{saved:true};
   }));
  }
 };
}
