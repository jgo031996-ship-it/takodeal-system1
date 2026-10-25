// Private local recovery only. This database is independent of Firestore's
// cache and of Cashier receipt storage; it never contains tokens or PINs.
import {createScheduleRevision,scheduleDateKey} from './schedule-history.js';
export const SCHEDULE_RECOVERY_DB='takodeal-owner-schedule-recovery-v1';
export const SCHEDULE_RECOVERY_MAX_AGE_MS=30*86400000;
const keys=['branchConfig','employees','unavailability','currentSchedule','currentYear','currentMonth','holidays'];
const clone=value=>structuredClone(value);
export const recoveryFingerprint=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const uid=value=>typeof value==='string'&&/^[-A-Za-z0-9_]{1,128}$/.test(value);
const revision=value=>value===null||typeof value==='string'&&/^[-A-Za-z0-9_]{1,100}$/.test(value);
const month=value=>typeof value==='string'&&/^(?:20|21)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
const day=value=>{if(typeof value!=='string'||!/^(?:20|21)\d{2}-\d{2}-\d{2}$/.test(value))return false;const at=new Date(value+'T00:00:00Z');return Number.isFinite(+at)&&at.toISOString().slice(0,10)===value;};
const exact=(value,allowed)=>Object.keys(value).sort().join(',')===[...allowed].sort().join(',');
function noSecrets(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(/(?:^pin|pin$|password|token$|credential|authorization|privateKey|secret|^auth$)/i.test(key))throw Error('Private login data cannot be stored in a schedule draft.');noSecrets(item);}}
export function scheduleDraftSnapshot(input){
 if(!plain(input))throw Error('The schedule draft is incomplete.');
 const output=Object.fromEntries(keys.filter(key=>input[key]!==undefined).map(key=>[key,clone(input[key])]));
 if(!Number.isInteger(output.currentYear)||output.currentYear<2000||output.currentYear>2199||!Number.isInteger(output.currentMonth)||output.currentMonth<1||output.currentMonth>12||!plain(output.branchConfig)||!plain(output.currentSchedule))throw Error('Choose a valid schedule month before preserving this draft.');
 noSecrets(output);return output;
}
export function scheduleSnapshotFingerprint(input){return recoveryFingerprint(scheduleDraftSnapshot(input));}
export async function scheduleRecoveryScope(identity,cryptoAPI=globalThis.crypto){
 const actor=typeof identity==='string'?{uid:identity}:identity;if(!plain(actor)||!uid(actor.uid))throw Error('Confirm the signed-in Owner account before preserving schedule edits.');
 const allowed=['uid','email','sessionUid','sessionEmail','permissions','branches','branch','assignedBranch','isOwner','isFranchisee','role'];
 const minimal=Object.fromEntries(allowed.filter(key=>actor[key]!==undefined).map(key=>[key,actor[key]]));
 const bytes=await cryptoAPI.subtle.digest('SHA-256',new TextEncoder().encode(recoveryFingerprint(minimal)));
 return {ownerUid:actor.uid,scopeHash:[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join('')};
}
export function scheduleDraftKey(scope,selected,editorId){if(!uid(scope?.ownerUid)||!/^[a-f0-9]{64}$/.test(scope.scopeHash)||!month(selected)||!uid(editorId))throw Error('Schedule recovery scope is invalid.');return JSON.stringify([scope.ownerUid,scope.scopeHash,selected,editorId]);}
export function validateScheduleDraft(record){
 if(!plain(record)||!exact(record,['schemaVersion','key','ownerUid','scopeHash','month','editorId','savedAt','editorSnapshot','effectiveFrom','base','pending'])||record.schemaVersion!==1||!uid(record.editorId)||!month(record.month)||!day(record.effectiveFrom)||record.effectiveFrom.slice(0,7)!==record.month||typeof record.savedAt!=='string'||!Number.isFinite(+new Date(record.savedAt))||!plain(record.base)||!exact(record.base,['revisionId','snapshotFingerprint'])||!revision(record.base.revisionId)||typeof record.base.snapshotFingerprint!=='string')throw Error('The saved recovery draft needs review.');
 const key=scheduleDraftKey(record,record.month,record.editorId),snapshot=scheduleDraftSnapshot(record.editorSnapshot);
 if(record.key!==key||`${snapshot.currentYear}-${String(snapshot.currentMonth).padStart(2,'0')}`!==record.month)throw Error('The saved recovery draft belongs to a different month.');
 let pending=null;if(record.pending!==null){const value=record.pending;if(!plain(value)||!exact(value,['revisionId','expectedRevisionId','effectiveFrom','snapshot'])||!revision(value.revisionId)||!value.revisionId||!revision(value.expectedRevisionId)||!day(value.effectiveFrom)||value.effectiveFrom.slice(0,7)!==record.month)throw Error('The unconfirmed save reference is incomplete.');const frozen=scheduleDraftSnapshot(value.snapshot);if(`${frozen.currentYear}-${String(frozen.currentMonth).padStart(2,'0')}`!==record.month)throw Error('The pending save belongs to a different month.');pending={revisionId:value.revisionId,expectedRevisionId:value.expectedRevisionId,effectiveFrom:value.effectiveFrom,snapshot:frozen};}
 const result={schemaVersion:1,key,ownerUid:record.ownerUid,scopeHash:record.scopeHash,month:record.month,editorId:record.editorId,savedAt:record.savedAt,editorSnapshot:snapshot,effectiveFrom:record.effectiveFrom,base:{revisionId:record.base.revisionId,snapshotFingerprint:record.base.snapshotFingerprint},pending};
 if(new TextEncoder().encode(JSON.stringify(result)).byteLength>4*1024*1024)throw Error('This schedule draft is too large to preserve on this device.');return result;
}
export function planScheduleDraftRecovery(record,view,{now=new Date(),maxAgeMs=SCHEDULE_RECOVERY_MAX_AGE_MS}={}){
 const draft=validateScheduleDraft(record);if(!view||view.month!==draft.month||!view.editorSnapshot)throw Error('Load a fresh saved schedule before reviewing recovery.');
 const age=+new Date(now)-+new Date(draft.savedAt);if(!Number.isFinite(age)||age>maxAgeMs||age< -5*60000)return {kind:'conflict',reason:'This local draft is older than the recovery window or its device clock needs review. It was kept for download; no saved schedule was replaced.',draft};
 const currentRevision=view.expectedRevisionId??null,currentFingerprint=scheduleSnapshotFingerprint(view.editorSnapshot);
 const proof=draft.pending&&(view.archive?.revisions||[]).find(row=>row.revisionId===draft.pending.revisionId);
 let expected=draft.pending?.snapshot;
 if(proof?.savedAt){try{expected=createScheduleRevision(draft.pending.snapshot,{revisionId:draft.pending.revisionId,effectiveFrom:draft.pending.effectiveFrom,savedAt:proof.savedAt,source:'manager-save',cutover:proof.payrollHistoryEnforcedFrom}).snapshot;}catch{return {kind:'conflict',reason:'The saved operation reference needs an HQ history review. The local draft remains available for download.',draft};}}
 if(proof&&(proof.source!=='manager-save'||proof.month!==draft.month||proof.effectiveFrom!==draft.pending.effectiveFrom||scheduleSnapshotFingerprint(proof.snapshot)!==scheduleSnapshotFingerprint(expected)))return {kind:'conflict',reason:'The saved operation reference does not match the frozen draft.',draft};
 if(proof&&currentRevision===draft.pending.revisionId&&currentFingerprint===scheduleSnapshotFingerprint(expected))return {kind:'committed',draft,baseRevision:currentRevision};
 if(!proof&&draft.pending&&draft.pending.effectiveFrom<scheduleDateKey(now))return {kind:'conflict',reason:'The original save is not confirmed and its effective date has passed. Keep this draft for HQ review; do not change its original save reference or recreate past schedule history.',draft};
 if(!proof&&currentRevision===draft.base.revisionId&&currentFingerprint===draft.base.snapshotFingerprint)return {kind:'restore',draft,baseRevision:currentRevision};
 return {kind:'conflict',reason:proof?'The original save reached HQ, but a newer saved schedule must be reviewed before restoring more edits.':'HQ has a different saved schedule. The local draft was kept; compare it before making another save.',draft};
}
export function createScheduleRecoveryDraftStore(indexedDB=globalThis.indexedDB,{delay=setTimeout,cancelDelay=clearTimeout,timeoutMs=2500}={}){
 let opening;
 async function open(){
  if(!indexedDB)throw Error('Local schedule backup is unavailable. Keep this editor open and download the draft before reloading.');
  if(!opening)opening=new Promise((resolve,reject)=>{let settled=false,request;const timer=delay(()=>finish(Error('Local schedule backup did not respond. Keep the editor open.')),timeoutMs);function finish(error,db){if(settled){db?.close();return;}settled=true;cancelDelay(timer);if(error){opening=null;reject(error);}else resolve(db);}try{request=indexedDB.open(SCHEDULE_RECOVERY_DB,1);}catch(error){finish(error);return;}request.onupgradeneeded=()=>{const store=request.result.createObjectStore('drafts',{keyPath:'key'});store.createIndex('context',['ownerUid','scopeHash','month']);};request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>{db.close();opening=null;};finish(null,db);};request.onerror=()=>finish(request.error||Error('Local schedule backup failed.'));request.onblocked=()=>finish(Error('Another page is blocking local schedule backup. Keep this editor open.'));});
  try{return await opening;}catch(error){opening=null;throw error;}
 }
 async function operation(mode,work){const db=await open();return new Promise((resolve,reject)=>{let tx,value,settled=false;const finish=(error)=>{if(settled)return;settled=true;cancelDelay(timer);error?reject(error):resolve(clone(value));};const timer=delay(()=>{try{tx?.abort();}catch{}finish(Error('Local schedule backup was not confirmed. Keep this editor open.'));},timeoutMs);try{tx=db.transaction('drafts',mode);const request=work(tx.objectStore('drafts'));request.onsuccess=()=>{value=request.result;};tx.oncomplete=()=>finish();tx.onerror=tx.onabort=()=>finish(tx.error||Error('Local schedule backup could not be saved.'));}catch(error){finish(error);}});}
 return {
  async write(record){const safe=validateScheduleDraft(record);await operation('readwrite',store=>store.put(safe));return clone(safe);},
  async list(scope,selected){scheduleDraftKey(scope,selected,'scope-check');const rows=await operation('readonly',store=>store.index('context').getAll([scope.ownerUid,scope.scopeHash,selected],51));if(!Array.isArray(rows)||rows.length>50)throw Error('Many recovery drafts need review. Keep the editor open before cleaning up local records.');return rows.map(validateScheduleDraft).filter(row=>row.ownerUid===scope.ownerUid&&row.scopeHash===scope.scopeHash&&row.month===selected).sort((a,b)=>b.savedAt.localeCompare(a.savedAt));},
  async remove(key){if(typeof key!=='string')throw Error('Invalid local recovery reference.');await operation('readwrite',store=>store.delete(key));}
 };
}
