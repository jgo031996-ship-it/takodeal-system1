const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const stamp=value=>value?.toMillis?.()??(value instanceof Date?+value:Date.parse(value));
const failed=()=>Error('Your PIN confirmation expired or the account, phone or request changed. Reopen it and confirm your own PIN again.');
export const staffProfileCollection=api=>api.staffProfileCollection==='staff_directory'?'staff_directory':'cashiers';
export async function prepareStaffPinProof(api,{pin,staffId,purpose,scope,branch,assertCurrent=()=>{}}){
 if(staffProfileCollection(api)!=='staff_directory')return null;
 if(typeof api.verifyStaffPin!=='function'||typeof api.staffPinActor!=='function')throw failed();
 const actor=api.staffPinActor(),key=JSON.stringify(actor);if(!id(actor?.uid)||typeof actor.deviceId!=='string'||!['staff','cashier'].includes(actor.app)||actor.app==='staff'&&!id(actor.sessionId))throw failed();
 assertCurrent();const result=await api.verifyStaffPin({pin,staffId,purpose,scope,...(branch?{branch}:{}),assertCurrent});assertCurrent();
 if(JSON.stringify(api.staffPinActor())!==key||result?.staffId!==staffId||!id(result.verificationId))throw failed();
 return{id:result.verificationId,actor,key,staffId,purpose,scope,branch};
}
export async function assertStaffPinProof(api,tx,proof,profile,{now=()=>new Date(),assertCurrent=()=>{}}={}){
 if(staffProfileCollection(api)!=='staff_directory')return;
 if(!proof||JSON.stringify(api.staffPinActor?.())!==proof.key)throw failed();
 assertCurrent();const snapshot=await tx.get(api.doc(api.db,'staff_pin_verifications',proof.id));assertCurrent();
 const row=snapshot?.exists?.()?snapshot.data():null;
 if(JSON.stringify(api.staffPinActor?.())!==proof.key||row?.schemaVersion!==1||row.uid!==proof.actor.uid||row.staffId!==proof.staffId||row.deviceId!==proof.actor.deviceId||row.app!==proof.actor.app||proof.actor.sessionId&&row.sessionId!==proof.actor.sessionId||row.purpose!==proof.purpose||row.scope!==proof.scope||proof.branch&&row.branch!==proof.branch||!Number.isFinite(stamp(row.expiresAt))||stamp(row.expiresAt)<=+now()||profile?.profileRevision&&row.profileRevision!==profile.profileRevision)throw failed();
}
