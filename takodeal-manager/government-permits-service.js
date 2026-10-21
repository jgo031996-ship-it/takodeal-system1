import {ownerRecordActor,checkOwnerRecordFile,appendOwnerRecordFileWrites} from './owner-record-files.js';
import {normalizePermitDraft,permitSnapshot} from './government-permits-model.js';
const reads=new WeakMap(),saves=new WeakMap(),uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const hash=async(api,value)=>[...new Uint8Array(await (api.crypto||globalThis.crypto).subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
function fresh(snapshot){if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('The saved permits could not be confirmed. Reconnect and refresh.');return snapshot;}
function timeLimit(promise,timeoutMs=25000){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('HQ has not confirmed this request yet. Reconnect and retry without changing the draft.')),timeoutMs);})]).finally(()=>clearTimeout(timer));}
function coalesce(map,api,key,work,intent){let entries=map.get(api);if(!entries){entries=new Map();map.set(api,entries);}let entry=entries.get(key);if(entry&&entry.intent!==intent)throw Error('This save is still being confirmed with different edits. Wait for its result before changing the draft.');if(!entry){let physical;try{physical=Promise.resolve(work());}catch(error){physical=Promise.reject(error);}entry={physical,intent};entries.set(key,entry);const release=()=>{if(entries.get(key)===entry)entries.delete(key);};physical.then(release,release);}return timeLimit(entry.physical);}
export function createGovernmentPermitService(api){
 const ref=(...parts)=>api.doc(api.db,...parts);
 function context(assertCurrent=()=>{}){const actor=ownerRecordActor(api);return {actor,guard(){assertCurrent();if(ownerRecordActor(api).key!==actor.key)throw Error('The Owner account changed. Open permits again.');}};}
 async function queryRows(key,reference,guard,actor){guard();const snap=fresh(await coalesce(reads,api,actor.key+'|'+key,()=>{guard();return api.getDocsFromServer(reference);}));guard();for(const row of snap.docs)fresh(row);return snap;}
 async function directory({assertCurrent=()=>{}}={}){const {actor,guard}=context(assertCurrent);const snap=await queryRows('branches',api.collection(api.db,'branches'),guard,actor);return [...new Set(snap.docs.map(row=>row.data()).filter(row=>row.active!==false&&row.name).map(row=>String(row.name)))].sort((a,b)=>a.localeCompare(b));}
 async function list({cursor=null,assertCurrent=()=>{}}={}){
  const {actor,guard}=context(assertCurrent);guard();const constraints=[api.orderBy('updatedAt','desc'),api.limit(201)];if(cursor)constraints.push(api.startAfter(cursor));const snap=await queryRows('list|'+(cursor?.id||''),api.query(api.collection(api.db,'government_permits'),...constraints),guard,actor),page=snap.docs.slice(0,200);
  return {rows:page.map(row=>({...row.data(),id:row.id})),partial:snap.docs.length>200,cursor:snap.docs.length>200?page.at(-1):null};
 }
 async function get(id,{assertCurrent=()=>{}}={}){if(!uuid(id))throw Error('Choose a saved permit.');const {actor,guard}=context(assertCurrent);guard();const snap=fresh(await coalesce(reads,api,actor.key+'|record|'+id,()=>{guard();return api.getDocFromServer(ref('government_permits',id));}));guard();if(!snap.exists())throw Error('This permit record is unavailable. Refresh the list.');return {...snap.data(),id:snap.id};}
 async function history(id,{cursor=null,assertCurrent=()=>{}}={}){if(!uuid(id))throw Error('Choose a saved permit.');const {actor,guard}=context(assertCurrent);const constraints=[api.orderBy('revision','desc'),api.limit(51)];if(cursor)constraints.push(api.startAfter(cursor));const snap=await queryRows('history|'+id+'|'+(cursor?.id||''),api.query(api.collection(api.db,'government_permits',id,'changes'),...constraints),guard,actor),page=snap.docs.slice(0,50);return {rows:page.map(row=>({...row.data(),id:row.id})),partial:snap.docs.length>50,cursor:snap.docs.length>50?page.at(-1):null};}
 async function save({id,operationId,expectedRevision=0,draft,reason='',preparedFile=null,assertCurrent=()=>{}}={}){
  if(!uuid(id)||!uuid(operationId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Reopen this permit before saving.');
  const {actor,guard}=context(assertCurrent),after=normalizePermitDraft({...draft,...(preparedFile?{attachment:preparedFile.descriptor}:{})});guard();
  if(after.attachment&&(after.attachment.kind!=='government_permit'||after.attachment.recordId!==id))throw Error('The supporting document belongs to another record.');
  const note=String(reason||'').trim();if(note.length>500)throw Error('Keep the change note within 500 characters.');
  const intent=await hash(api,JSON.stringify([id,expectedRevision,after,note]));guard();const key=actor.key+'|'+id+'|'+operationId;
  return coalesce(saves,api,key,async()=>{
   const branches=await directory({assertCurrent:guard});guard();
   return api.runTransaction(api.db,async tx=>{
    guard();const currentRef=ref('government_permits',id),changeRef=ref('government_permits',id,'changes',operationId),[current,changed]=await Promise.all([tx.get(currentRef),tx.get(changeRef)]);guard();
    if(changed.exists()){const old=changed.data();if(old.intent!==intent||old.recordId!==id||old.recordedByUid!==actor.uid)throw Error('This save reference has different edits. Refresh the permit before retrying.');return {id,revision:old.revision,repeated:true};}
    const before=current.exists()?current.data():null;if((before?.revision||0)!==expectedRevision)throw Error('This permit changed on another device. Reopen it before editing.');
    if(!branches.includes(after.branch)&&(!before||after.branch!==before.branch))throw Error('Choose an existing branch from the directory.');
    if(before&&before.recordId!==id)throw Error('The saved permit identity needs Owner review.');
    if(!preparedFile&&JSON.stringify(after.attachment)!==JSON.stringify(before?.attachment??null))throw Error('Choose the supporting document before changing its reference.');
    const action=!before?'Created':before.archived!==after.archived?(after.archived?'Archived':'Restored'):'Updated';
    if(['Archived','Restored'].includes(action)&&note.length<4)throw Error('Add a short reason for archiving or restoring this permit.');
    const fileState=await checkOwnerRecordFile(api,tx,preparedFile,{assertCurrent:guard});guard();const stamp=api.serverTimestamp(),revision=expectedRevision+1;
    const saved={schemaVersion:1,recordId:id,...after,revision,createdAt:before?.createdAt??stamp,createdByUid:before?.createdByUid??actor.uid,createdByEmail:before?.createdByEmail??actor.email,updatedAt:stamp,updatedByUid:actor.uid,updatedByEmail:actor.email,lastChangeId:operationId};
    tx.set(currentRef,saved);tx.set(changeRef,{schemaVersion:1,operationId,recordId:id,revision,action,before:before?permitSnapshot(before):null,after:permitSnapshot(saved),reason:note||(!before?'Added permit':'Updated permit details'),recordedAt:stamp,recordedByUid:actor.uid,recordedByEmail:actor.email,intent});
    appendOwnerRecordFileWrites(api,tx,preparedFile,fileState,{assertCurrent:guard});return {id,revision,repeated:false};
   });
  },intent);
 }
 return {directory,list,get,history,save};
}
