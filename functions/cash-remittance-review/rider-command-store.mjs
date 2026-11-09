import{isIP}from'node:net';
import{riderAccessHash,riderAccessId}from'./rider-access-model.mjs';
const fields={
 riders:['name','phone','plateNumber','selfieUrl','status','active','archived','deleted','blocked','walletBalance','isAcceptingOrders','allowedBranches','fleetType','franchiseAccess','riderPinManaged','riderAuthRevision','pin','approvalOperation','lastLat','lastLng','lastActive'],
 incoming_orders:['branch','orderType','totalAmount','paymentMode','paymentMethod','paymentStatus','status','riderId','pingedRider','receiptId','orderCode','riderClaim','riderPickup','riderCompletion','declinedBy','riderDeclines'],
 rider_topups:['riderId','riderName','reference','proofUrl','status','amountAdded','requestOperation','reviewOperation'],
 transactions:['branch','receiptId','paymentVerified','status','paymentMethod','paymentStatus','mobileOrderId','isPendingSync','cancelled','canceled','refunded','refundAmount','splitDetails'],
 online_order_incidents:['status'],
 rider_credentials:['schemaVersion','riderId','riderAuthRevision','verifier'],
 rider_login_sessions:['schemaVersion','uid','riderId','sessionId','riderAuthRevision','issuedAt','expiresAt','revoked'],
 rider_session_cancellations:['uid','sessionId'],
 rider_command_operations:['schemaVersion','actorUid','actorType','riderId','action','operationId','sessionId','intentHash','state','result','recordedAt'],
 hq_email_access:['active','permissions','allowedBranches'],
 hq_account_index:['email','schemaVersion','sourceProfileId','sourceAccess','active','ambiguous','role','permissions','allowedBranches'],
};
const allowed={
 claim:{incoming_orders:['status','riderId','riderName','riderPhone','riderPlate','riderSelfie','riderClaimedAt','acceptedAt','pingedRider','riderClaim'],riders:['walletBalance','riderActionSessionId','riderWalletOperation']},
 'accept-ping':null,pickup:{incoming_orders:['riderPickup','riderPickedUpAt']},complete:{incoming_orders:['status','deliveredAt','proofOfDeliveryUrl','riderCompletion']},decline:{incoming_orders:['pingedRider','declinedBy','riderDeclines']},
 availability:{riders:['isAcceptingOrders','availabilityUpdatedAt','riderActionSessionId']},location:{riders:['lastLat','lastLng','lastActive','riderActionSessionId']},
 'topup-request':{rider_topups:['riderId','riderName','reference','proofUrl','status','timestamp','requestOperation']},
 'review-status':{riders:['status','isAcceptingOrders','approvalOperation','statusReviewedAt','statusReviewedBy']},
 'review-topup':{rider_topups:['status','amountAdded','processedAt','processedBy','reviewOperation'],riders:['walletBalance','riderWalletOperation']}
};allowed['accept-ping']=allowed.claim;
const fail=message=>{throw Error(message);};
export function createRiderCommandStore(db,{serverTimestamp,now=Date.now}={}){
 if(typeof db?.runTransaction!=='function'||typeof serverTimestamp!=='function')fail('A trusted Rider command database is required.');
 return{
  async rate({uid,ip,action}){
   if(!riderAccessId(uid))fail('A verified command identity is required.');
   const slot=Math.floor(now()/900000),bucket=action==='location'?'location':action==='status'?'recovery':'commands',limits=bucket==='location'?[90,450,3000]:bucket==='recovery'?[90,450,3000]:[90,450,3000],keys=[['uid',uid],['ip',isIP(ip||'')?ip:'shared-unknown'],['global','all']];
   await db.runTransaction(async tx=>{const refs=keys.map(([kind,value])=>db.doc('rider_command_attempts/'+riderAccessHash({kind,value,slot,bucket}))),snaps=await Promise.all(refs.map(ref=>tx.get(ref)));for(let i=0;i<snaps.length;i++){const count=snaps[i].exists?snaps[i].data().count:0;if(!Number.isSafeInteger(count)||count<0||count>=limits[i])throw Object.assign(Error('Too many Rider commands. Wait before retrying.'),{status:429,code:'rider-command/rate-limit'});}for(let i=0;i<refs.length;i++)tx.set(refs[i],{count:(snaps[i].exists?snaps[i].data().count:0)+1,expiresAt:new Date((slot+2)*900000)});});
  },
  transaction(action,work){
   return db.runTransaction(async transaction=>{
    let wrote=false,reads=0;const cache=new Map(),known=new Map();
    const path=(table,id)=>{if(!Object.hasOwn(fields,table)||!(['hq_email_access','hq_account_index'].includes(table)?typeof id==='string'&&id===id.toLowerCase()&&/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(id):typeof id==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(id)))fail('Only exact Rider command paths are allowed.');return table+'/'+id;};
    const get=async(table,id)=>{
     if(wrote)fail('Read all Rider command sources before writing.');const key=path(table,id);
     if(!cache.has(key)){if(++reads>40)fail('The Rider command read budget was exceeded.');cache.set(key,(async()=>{const ref=db.doc(key),snapshot=typeof transaction.getAll==='function'?(await transaction.getAll(ref,{fieldMask:fields[table]}))[0]:await transaction.get(ref),data=snapshot.exists?{...snapshot.data(),id}:null;known.set(key,data);return data;})());}
     return cache.get(key);
    };
    const query=async(table,filters,projection,limit)=>{if(wrote)fail('Read Rider command sources first.');let q=db.collection(table);for(const[field,operator,value]of filters)q=q.where(field,operator,value);const snapshot=await transaction.get(q.select(...projection).limit(limit));reads+=snapshot.size;if(reads>40||snapshot.size>=limit)throw Object.assign(Error('These saved Rider sources need HQ review.'),{status:409,code:'rider-command/ambiguous'});return snapshot.docs.map(row=>({...row.data(),id:row.id}));};
    const write=(ref,patch,create)=>{const key=path(ref.table,ref.id),keys=allowed[action]?.[ref.table];if(!cache.has(key)||!keys||!patch||!Object.keys(patch).length||Object.keys(patch).some(key=>!keys.includes(key))||Buffer.byteLength(JSON.stringify(patch))>131072)fail('This command cannot change those Rider fields.');if(create?known.get(key)!==null:!known.get(key))fail('Read the exact existing Rider record before changing it.');wrote=true;create?transaction.create(db.doc(key),patch):transaction.update(db.doc(key),patch);};
    const hqFields=['email','uid','role','fullName','permissions','assignedBranch','active','isActive','blocked','status','disabled','archived','isArchived','deleted','isDeleted','revoked','offboarded','resigned','terminated','employmentStatus','contractStatus','pin','securityPin','permissionsUpdatedAt','pinUpdatedAt'];
    return work({get,serverTimestamp,
     hqRecords:email=>query('hq_managers',[['email','==',email]],hqFields,email==='jgo031996@gmail.com'?11:3),
     receipts:(receiptId,branch)=>query('transactions',[['receiptId','==',receiptId],['branch','==',branch]],fields.transactions,3),
     snapshot:async ref=>{const row=await get(ref.table,ref.id);return{id:ref.id,exists:()=>row!==null,data:()=>row};},
     update:(ref,patch)=>write(ref,patch,false),create:(ref,patch)=>write(ref,patch,true),
     createOperation(id,value){const key=path('rider_command_operations',id);if(!cache.has(key)||known.get(key)!==null||value.schemaVersion!==1||!['saved','closed'].includes(value.state)||Buffer.byteLength(JSON.stringify(value))>16384)fail('Only one exact immutable Rider operation may be recorded.');wrote=true;transaction.create(db.doc(key),value);}
    });
   });
  }
 };
}
