const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value);
const ownerEmail='jgo031996@gmail.com';
const fresh=snapshot=>{if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Reconnect to confirm this tablet with HQ.');return snapshot;};
const canonical=value=>value?.toMillis?value.toMillis():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const fingerprint=value=>JSON.stringify(canonical(value));
export const isCashierFleetDevice=data=>!!data&&String(data.appType||'').trim().toLowerCase()!=='staff'&&data.setupVersion!==1&&!data.setupUid&&key(data.deviceId);
export function createCashierFleetApproval(api){
 const actor=()=>{const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||user.email?.toLowerCase()!==ownerEmail||user.emailVerified!==true||session?.uid!==user.uid||session.isOwner!==true||session.isFranchisee)throw Error('Unlock the verified Owner workspace to approve Cashier tablets.');return user;};
 const capture=()=>{const user=actor();return {user,guard(){if(actor()!==user)throw Error('The Owner account changed. Reopen Device Fleet.');}};};
 async function read(id,scope,selectedUid){if(!key(id)||selectedUid&&!key(selectedUid))throw Error('Invalid tablet registration.');scope.guard();const ref=api.doc(api.db,'pos_devices',id),snap=fresh(await api.getDocFromServer(ref));scope.guard();if(!snap.exists())throw Error('This tablet is no longer listed. Refresh Device Fleet.');const device=snap.data();if(!isCashierFleetDevice(device))return {id,ref,snap,device,bindings:[]};
  // Public clients can only create Pending claims. Keep those claims from
  // preventing revocation of the independently queried Active identities.
  const query=(...terms)=>api.query(api.collection(api.db,'pos_bindings'),api.where('legacyDeviceDocId','==',id),...terms,api.limit(21));
  const active=fresh(await api.getDocsFromServer(query(api.where('status','==','Active'))));scope.guard();
  if(active.docs.length>=21)throw Error('This tablet has too many Active identities. Ask HQ to review secure access.');
  const list=fresh(await api.getDocsFromServer(query()));scope.guard();const raw=new Map([...list.docs,...active.docs].map(s=>[s.id,s]));
  if(selectedUid){const selected=fresh(await api.getDocFromServer(api.doc(api.db,'pos_bindings',selectedUid)));scope.guard();if(selected.exists())raw.set(selectedUid,selected);}
  const bindings=[...raw.values()].map(s=>{fresh(s);const data=s.data();if(!key(s.id)||data.legacyDeviceDocId!==id)throw Error('The selected tablet identity belongs to another registration.');const valid=data.uid===s.id&&data.deviceId===device.deviceId&&data.branch===device.branch&&['Pending','Active','Revoked','Blocked'].includes(data.status);return {uid:s.id,ref:api.doc(api.db,'pos_bindings',s.id),data,valid};});return {id,ref,snap,device,bindings,claimsOverflow:list.docs.length>=21};
 }
 async function mutate(row,scope,action,uid){
  const changeId=(api.crypto||globalThis.crypto)?.randomUUID?.();if(!key(changeId))throw Error('Secure approval references are unavailable. Update the Owner app.');
  return api.runTransaction(api.db,async tx=>{scope.guard();const live=await tx.get(row.ref);scope.guard();if(!live.exists()||fingerprint(live.data())!==fingerprint(row.device))throw Error('The tablet registration changed. Refresh and review it again.');
   const copies=[];for(const binding of row.bindings){const current=await tx.get(binding.ref);scope.guard();if(!current.exists()||fingerprint(current.data())!==fingerprint(binding.data))throw Error('Tablet approval changed. Refresh and review it again.');copies.push(binding);}
   const time=api.serverTimestamp(),email=scope.user.email,rawRevision=row.device.cashierApprovalRevision,previousRevision=Number.isSafeInteger(rawRevision)&&rawRevision>=0&&rawRevision<Number.MAX_SAFE_INTEGER?rawRevision:0;
   const stamp={cashierApprovalRevision:previousRevision+1,cashierApprovalChangeId:changeId,cashierApprovalChangedAt:time,cashierApprovalByUid:scope.user.uid};
   if(action==='approve'){
    const target=copies.find(b=>b.uid===uid);if(!target)throw Error('No matching tablet identity was selected.');
    // Approve only the UID matched with the physical tablet; never all Pending UIDs.
    for(const b of copies)if(b.uid!==uid&&b.data.status==='Active')tx.update(b.ref,{status:'Revoked',revokedAt:time,revokedBy:email});
    tx.update(target.ref,{status:'Active',approvedAt:time,approvedBy:email});tx.update(row.ref,{status:'Active',...stamp});
   }else{
    for(const b of copies)if(b.data.status!=='Revoked')tx.update(b.ref,{status:'Revoked',revokedAt:time,revokedBy:email});
    if(action==='delete')tx.delete(row.ref);else tx.update(row.ref,{status:'Blocked',...stamp});
   }
   scope.guard();return {status:action==='approve'?'Active':action==='delete'?'Deleted':'Blocked',uid:uid||null};
  });
 }
 return {
  async inspect(id){const scope=capture();return read(id,scope);},
  async approve(id,uid){const scope=capture(),row=await read(id,scope,uid);if(!isCashierFleetDevice(row.device))throw Error('Use the Staff phone controls for this device.');
   const eligible=row.bindings.filter(b=>b.valid&&['Pending','Active'].includes(b.data.status));
   if(!uid&&row.claimsOverflow)throw Error('Choose and match the exact Approval UID shown on the Cashier tablet. Other setup claims need HQ review.');
   if(!uid){if(eligible.length!==1)throw Error(eligible.length?'Choose and match the exact Approval UID shown on the Cashier tablet.':'Open or update the Cashier app on this tablet first. Its setup will appear here automatically; no feature request is needed.');uid=eligible[0].uid;}
   const target=row.bindings.find(b=>b.uid===uid);if(!target?.valid||!['Pending','Active','Revoked','Blocked'].includes(target.data.status))throw Error('The selected tablet identity does not match its device and branch. Refresh Device Fleet.');
   const replace=row.bindings.some(b=>b.uid!==uid&&b.data.status==='Active');
   const result=await api.Swal.fire({title:'Approve this Cashier tablet?',text:'Match Approval UID '+uid+' on the physical tablet. Branch: '+row.device.branch+'. Device: '+(row.device.deviceName||'Branch tablet')+' ('+row.device.deviceId+'). One approval covers Cash Remittance, Stock Audits and Schedule Proposals.'+(replace?' This replaces older secure access for this tablet.':''),icon:'question',showCancelButton:true,confirmButtonText:'Approve matched tablet'});scope.guard();if(!result.isConfirmed)return {cancelled:true};return mutate(row,scope,'approve',uid);
  },
  async change(id,action){if(!['block','delete'].includes(action))throw Error('Unsupported tablet action.');const scope=capture(),row=await read(id,scope);if(!isCashierFleetDevice(row.device))return false;return mutate(row,scope,action);}
 };
}
