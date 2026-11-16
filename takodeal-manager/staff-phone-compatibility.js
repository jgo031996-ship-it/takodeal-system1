const OWNER='jgo031996@gmail.com';
const deviceId=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const eligible=row=>row?.status==='Active'&&!Object.hasOwn(row,'appType')&&deviceId(row.deviceId)&&typeof row.deviceName==='string'&&/\(Staff\)\s*$/i.test(row.deviceName)&&typeof row.branch==='string'&&row.branch.trim()&& !['setupVersion','setupUid','staffId','protocolVersion'].some(key=>Object.hasOwn(row,key));
// Repair a legacy app label only. Status, credentials, branch and UID bindings
// are never granted or changed by this compatibility operation.
export async function repairApprovedStaffPhoneLabels(api,{auth,assertCurrent=()=>{}}={}){
 const user=auth?.currentUser;
 if(!user||user.email?.toLowerCase()!==OWNER||user.emailVerified!==true||user.isAnonymous===true||!user.providerData?.some(row=>row.providerId==='google.com'))return {repaired:0,skipped:true};
 const guard=()=>{assertCurrent();if(auth.currentUser!==user)throw Error('The Owner account changed during the phone check.');};guard();
 const token=await user.getIdTokenResult(true);guard();
 if(token.claims?.sub!==user.uid||String(token.claims.email||'').toLowerCase()!==OWNER||token.claims.email_verified!==true||token.claims.firebase?.sign_in_provider!=='google.com')throw Error('Use the verified Owner account to check old Staff phone records.');
 const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'pos_devices'),api.limit(201)));guard();
 if(!Array.isArray(snap.docs)||snap.docs.length>=201||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('The complete phone directory could not be confirmed.');
 const counts=new Map();for(const doc of snap.docs){const id=doc.data().deviceId;counts.set(id,(counts.get(id)||0)+1);}
 const candidates=snap.docs.filter(doc=>eligible(doc.data())&&counts.get(doc.data().deviceId)===1).map(doc=>({ref:api.doc(api.db,'pos_devices',doc.id),before:doc.data()}));
 let repaired=0;
 for(let at=0;at<candidates.length;at+=40){const group=candidates.slice(at,at+40);repaired+=await api.runTransaction(api.db,async tx=>{
  guard();const rows=await Promise.all(group.map(async item=>({item,snapshot:await tx.get(item.ref)})));guard();let count=0;
  for(const {item,snapshot}of rows){const row=snapshot.exists()?snapshot.data():null;if(!eligible(row)||row.deviceId!==item.before.deviceId||row.deviceName!==item.before.deviceName||row.branch!==item.before.branch)continue;tx.update(item.ref,{appType:'Staff'});count++;}guard();return count;
 });guard();}
 return {repaired,checked:snap.docs.length};
}
