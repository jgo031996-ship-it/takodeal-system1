import {OWNER_EMAIL} from './workspace-access-model.js';

export const OWNER_FILE_LIMITS=Object.freeze({bytes:2*1024*1024,chunkBytes:144*1024,base64Characters:192*1024,chunks:15,timeoutMs:25000});
const kinds=new Set(['government_permit','sss_remittance','bookkeeper_payment']),plans=new WeakMap(),checks=new WeakMap(),pendingReads=new WeakMap(),urls=new WeakMap();
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const recordId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function ownerRecordActor(api){
 const user=api.auth?.currentUser,session=api.sessionUser,email=String(user?.email||'').toLowerCase();
 if(!user?.uid||email!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||String(session.email||'').toLowerCase()!==email||session.isFranchisee===true)throw Error('Unlock the verified Owner account to manage compliance records.');
 return {uid:user.uid,email,key:JSON.stringify([user.uid,email,session.uid,session.email,session.role,session.isOwner,session.isFranchisee,session.permissions,session.allowedBranches])};
}
function guardFor(api,assertCurrent=()=>{}){const actor=ownerRecordActor(api);return {actor,guard(){assertCurrent();if(ownerRecordActor(api).key!==actor.key)throw Error('The Owner account changed. Reopen this record.');}};}
const digest=async(api,bytes)=>[...new Uint8Array(await (api.crypto||globalThis.crypto).subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
function encode(bytes){let binary='';for(let at=0;at<bytes.length;at+=8192)binary+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(binary);}
function decode(value){if(typeof value!=='string'||value.length>OWNER_FILE_LIMITS.base64Characters||!value.length)throw Error('A private document chunk is invalid.');try{return Uint8Array.from(atob(value),character=>character.charCodeAt(0));}catch{throw Error('A private document chunk is invalid.');}}
function mime(bytes){if(bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d)return 'application/pdf';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'image/png';throw Error('Choose a PDF, JPEG or PNG document.');}
export function ownerRecordFileDescriptor(prepared){return prepared?.descriptor||null;}
export function validateOwnerRecordFileDescriptor(value){
 if(!value||Object.keys(value).sort().join('|')!==['id','kind','recordId','fileName','contentType','size','sha256','chunkCount'].sort().join('|')||!uuid(value.id)||!kinds.has(value.kind)||!recordId(value.recordId)||typeof value.fileName!=='string'||!value.fileName.trim()||value.fileName.length>160||/[\x00-\x1f\x7f]/.test(value.fileName)||!['application/pdf','image/jpeg','image/png'].includes(value.contentType)||!Number.isSafeInteger(value.size)||value.size<1||value.size>OWNER_FILE_LIMITS.bytes||!hex(value.sha256)||value.chunkCount!==Math.ceil(value.size/OWNER_FILE_LIMITS.chunkBytes))throw Error('The private document reference is invalid. Refresh the saved record.');
 return value;
}
function bounded(work,guard,timeoutMs=OWNER_FILE_LIMITS.timeoutMs){let timer,expired=false;const check=()=>{if(expired)throw Error('Private document confirmation timed out. Reconnect and try again.');guard();};let task;try{task=Promise.resolve(work(check));}catch(error){task=Promise.reject(error);}return Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(Error('Private document confirmation timed out. Reconnect and try again.'));},timeoutMs);})]).finally(()=>clearTimeout(timer));}
export async function prepareOwnerRecordFile(api,{file,kind,recordId:target,fileId,operationId,assertCurrent=()=>{}}={}){
 const {actor,guard}=guardFor(api,assertCurrent);guard();if(!file)return null;
 if(!kinds.has(kind)||!recordId(target)||!uuid(fileId)||!uuid(operationId))throw Error('Reopen this record before attaching its document.');
 if(!Number.isSafeInteger(file.size)||file.size<1||file.size>OWNER_FILE_LIMITS.bytes||typeof file.arrayBuffer!=='function')throw Error('Choose a document no larger than 2 MiB.');
 return bounded(async check=>{
  check();const bytes=new Uint8Array(await file.arrayBuffer());check();if(bytes.length!==file.size||bytes.length>OWNER_FILE_LIMITS.bytes)throw Error('The selected document size changed. Choose it again.');
  const contentType=mime(bytes);if(file.type&&file.type!==contentType)throw Error('The document contents do not match its file type.');
  const fileName=String(file.name||'Supporting document').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,160)||'Supporting document';
  const chunks=[];for(let at=0;at<bytes.length;at+=OWNER_FILE_LIMITS.chunkBytes){const part=bytes.subarray(at,at+OWNER_FILE_LIMITS.chunkBytes);chunks.push({schemaVersion:1,fileId,index:chunks.length,size:part.length,sha256:await digest(api,part),data:encode(part)});check();}
  const descriptor=Object.freeze({id:fileId,kind,recordId:target,fileName,contentType,size:bytes.length,sha256:await digest(api,bytes),chunkCount:chunks.length});check();
  const prepared=Object.freeze({descriptor});plans.set(prepared,{api,actor,operationId,chunks});return prepared;
 },guard);
}
const sameDescriptor=(a,b)=>['id','kind','recordId','fileName','contentType','size','sha256','chunkCount'].every(key=>a?.[key]===b?.[key]);
export async function checkOwnerRecordFile(api,tx,prepared,{assertCurrent=()=>{}}={}){
 const {actor,guard}=guardFor(api,assertCurrent);guard();if(!prepared)return null;
 const plan=plans.get(prepared);if(!plan||plan.api!==api||plan.actor.key!==actor.key)throw Error('Choose the private document again under this Owner session.');
 validateOwnerRecordFileDescriptor(prepared.descriptor);const snap=await tx.get(api.doc(api.db,'owner_record_files',prepared.descriptor.id));guard();
 if(snap.exists()){const saved=snap.data();if(!sameDescriptor(saved,prepared.descriptor)||saved.operationId!==plan.operationId||saved.createdByUid!==actor.uid||saved.createdByEmail!==actor.email||saved.schemaVersion!==1||saved.chunkSize!==OWNER_FILE_LIMITS.chunkBytes)throw Error('This private upload reference is already used. Choose the document again.');}
 const state=Object.freeze({exists:snap.exists()});checks.set(state,{api,tx,prepared,actor});return state;
}
export function appendOwnerRecordFileWrites(api,tx,prepared,state,{assertCurrent=()=>{}}={}){
 const {actor,guard}=guardFor(api,assertCurrent);guard();if(!prepared){if(state)throw Error('Unexpected private document state.');return;}
 const checked=checks.get(state),plan=plans.get(prepared);if(!checked||checked.api!==api||checked.tx!==tx||checked.prepared!==prepared||checked.actor.key!==actor.key||!plan)throw Error('Confirm the private document before saving this record.');
 if(state.exists)return;
 const descriptor=prepared.descriptor;guard();tx.set(api.doc(api.db,'owner_record_files',descriptor.id),{schemaVersion:1,...descriptor,chunkSize:OWNER_FILE_LIMITS.chunkBytes,operationId:plan.operationId,createdAt:api.serverTimestamp(),createdByUid:actor.uid,createdByEmail:actor.email});
 for(const chunk of plan.chunks){guard();tx.set(api.doc(api.db,'owner_record_files',descriptor.id,'chunks',String(chunk.index).padStart(4,'0')),chunk);}
}
function freshRead(api,path,guard){
 guard();if(typeof api.getDocFromServer!=='function')throw Error('Reconnect to open a private document.');
 const actor=ownerRecordActor(api).key;let reads=pendingReads.get(api);if(!reads){reads=new Map();pendingReads.set(api,reads);}const key=actor+'|'+path.join('/');let entry=reads.get(key);
 if(!entry){let physical;try{guard();physical=Promise.resolve(api.getDocFromServer(api.doc(api.db,...path)));}catch(error){physical=Promise.reject(error);}entry={physical};reads.set(key,entry);physical.then(()=>{if(reads.get(key)===entry)reads.delete(key);},()=>{if(reads.get(key)===entry)reads.delete(key);});}
 return entry.physical.then(snap=>{guard();if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||!snap.exists())throw Error('This private document is unavailable. Refresh the record.');return snap.data();});
}
export async function readOwnerRecordFile(api,descriptor,{assertCurrent=()=>{},timeoutMs=OWNER_FILE_LIMITS.timeoutMs}={}){
 const {guard}=guardFor(api,assertCurrent);guard();validateOwnerRecordFileDescriptor(descriptor);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>OWNER_FILE_LIMITS.timeoutMs)throw Error('The private document timeout is invalid.');
 return bounded(async check=>{
  const manifest=await freshRead(api,['owner_record_files',descriptor.id],check);check();if(!sameDescriptor(manifest,descriptor)||manifest.schemaVersion!==1||manifest.chunkSize!==OWNER_FILE_LIMITS.chunkBytes)throw Error('The saved private document does not match this record.');
  const parts=new Array(descriptor.chunkCount);let next=0,failure;
  await Promise.all(Array.from({length:Math.min(4,descriptor.chunkCount)},async()=>{while(!failure&&next<descriptor.chunkCount){const index=next++;try{check();const row=await freshRead(api,['owner_record_files',descriptor.id,'chunks',String(index).padStart(4,'0')],check);check();const expected=Math.min(OWNER_FILE_LIMITS.chunkBytes,descriptor.size-index*OWNER_FILE_LIMITS.chunkBytes);if(row.schemaVersion!==1||row.fileId!==descriptor.id||row.index!==index||row.size!==expected||!hex(row.sha256))throw Error('A private document chunk does not match its record.');const bytes=decode(row.data);if(bytes.length!==expected||await digest(api,bytes)!==row.sha256)throw Error('Private document integrity could not be confirmed.');check();parts[index]=bytes;}catch(error){failure||=error;}}}));if(failure)throw failure;
  const bytes=new Uint8Array(descriptor.size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}if(at!==descriptor.size||await digest(api,bytes)!==descriptor.sha256||mime(bytes)!==descriptor.contentType)throw Error('Private document integrity could not be confirmed.');check();return new Blob([bytes],{type:descriptor.contentType});
 },guard,timeoutMs);
}
export async function downloadOwnerRecordFile(api,d,descriptor,{assertCurrent=()=>{}}={}){
 const {guard}=guardFor(api,assertCurrent),blob=await readOwnerRecordFile(api,descriptor,{assertCurrent});guard();const URLApi=api.URL||globalThis.URL,url=URLApi.createObjectURL(blob);let entries=urls.get(api);if(!entries){entries=new Map();urls.set(api,entries);}const release=()=>{const row=entries.get(url);if(row){(api.clearTimeout||clearTimeout)(row.timer);URLApi.revokeObjectURL(url);entries.delete(url);}};
 try{guard();const link=d.createElement('a');link.href=url;link.download=descriptor.fileName;d.body.appendChild(link);link.click();link.remove();entries.set(url,{timer:(api.setTimeout||setTimeout)(release,30000)});return {fileName:descriptor.fileName,size:blob.size};}catch(error){URLApi.revokeObjectURL(url);throw error;}
}
export function revokeOwnerRecordFileUrls(api){const entries=urls.get(api);if(!entries)return;for(const [url,row]of entries){(api.clearTimeout||clearTimeout)(row.timer);(api.URL||globalThis.URL).revokeObjectURL(url);}entries.clear();}
