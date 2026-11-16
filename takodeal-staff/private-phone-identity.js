// Pay/profile may use a freshly confirmed personal-code registration.
// Legacy private-document clients retain their separately approved UID.
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const device=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const failure=kind=>Object.assign(Error('This private phone approval could not be verified. Reconnect or ask HQ to review it.'),{code:'private-phone/'+kind});
export async function resolvePrivatePhoneIdentity({client,staffId,assertCurrent=()=>{}}={}){
 const user=client?.auth?.currentUser,sdk=client?.sdk;if(!id(staffId)||!id(user?.uid)||user.isAnonymous!==true||typeof sdk?.doc!=='function'||typeof sdk?.getDocFromServer!=='function')throw failure('denied');
 const guard=()=>{assertCurrent();if(client.auth.currentUser!==user||user.isAnonymous!==true)throw failure('changed');};
 if(client.personalVaultPhone){
  const {authority:a,staffId:boundStaff,deviceId:boundDevice}=client.personalVaultPhone;
  if(boundStaff!==staffId||!device(boundDevice)||!a?.confirm||!a?.capture||!a?.assert)throw failure('denied');
  async function confirm(){guard();await a.confirm(boundDevice);guard();const b=a.binding?.();if(a.mode?.()!=='protected'||!a.isVerified?.()||b?.status!=='Active'||b.staffId!==staffId||b.deviceId!==boundDevice||typeof b.branch!=='string'||!b.branch.trim())throw failure('denied');return b;}
  const binding=await confirm(),proof=a.capture();
  return{uid:user.uid,staffId,deviceId:boundDevice,branch:binding.branch,async assertFresh(){const next=await confirm();a.assert(proof,staffId);guard();if(next.branch!==binding.branch)throw failure('changed');}};
 }

 async function read(){guard();let snap;try{snap=await sdk.getDocFromServer(sdk.doc(client.db,'staff_document_devices',user.uid));}catch{guard();throw failure('unavailable');}guard();if(!snap||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||typeof snap.exists!=='function'||!snap.exists())throw failure('denied');const binding=snap.data();if(binding?.active!==true||binding.uid!==user.uid||binding.staffId!==staffId||!device(binding.deviceId)||typeof binding.branch!=='string'||!binding.branch.trim()||binding.branch.length>128)throw failure('denied');return{uid:user.uid,staffId,deviceId:binding.deviceId,branch:binding.branch};}
 const binding=await read();return{...binding,async assertFresh(){const next=await read();if(next.deviceId!==binding.deviceId||next.branch!==binding.branch)throw failure('changed');}};
}
