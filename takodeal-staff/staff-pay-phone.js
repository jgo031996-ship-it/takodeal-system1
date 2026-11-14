// Personal setup-code activation authorizes this employee's Pay/profile on the
// same protected phone. Document uploads keep their separate private client.
export async function createStaffPayPhoneClient({auth,db,sdk,authority,identity,deviceId,createPrivateClient,assertCurrent=()=>{}}={}){
 const staffId=identity(),selectedDevice=deviceId();await auth.authStateReady?.();const user=auth.currentUser,a=typeof authority==='function'?authority():authority;
 const guard=()=>{assertCurrent();if(identity()!==staffId||deviceId()!==selectedDevice||auth.currentUser!==user)throw Error('Your Staff account or phone changed. Reopen Pay.');};guard();
 if(user?.isAnonymous===true&&a?.confirm){
  try{await a.confirm(selectedDevice);guard();const b=a.binding?.();if(a.mode?.()==='protected'&&a.isVerified?.()&&b?.status==='Active'&&b.staffId===staffId&&b.deviceId===selectedDevice)return{auth,db,sdk,personalVaultPhone:{authority:a,staffId,deviceId:selectedDevice}};}catch{guard();}
 }
 const client=await createPrivateClient();guard();return client;
}
