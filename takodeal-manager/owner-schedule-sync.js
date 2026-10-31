import {createScheduleRecoveryDraftStore,scheduleRecoveryScope,scheduleDraftSnapshot,scheduleDraftKey,scheduleSnapshotFingerprint,planScheduleDraftRecovery} from './schedule-recovery-draft.js';
import {planScheduleCalendar,scheduleCalendarError} from './schedule-calendar.js';
const clone=value=>structuredClone(value);
const fingerprint=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
/** Owns only the editor's read/save lifecycle. It never changes schedule rules. */
export function createOwnerScheduleSync({readView,applyView,getSnapshot,getMonth,getIdentity,authorize=()=>true,getExpectedRevision,setExpectedRevision,getEffectiveFrom,saveSnapshot,
 isActive=()=>true,isProtected=()=>false,confirmDiscard=async()=>false,subscribe=()=>()=>{},onStatus=()=>{},onSaved=()=>{},onLoading=()=>{},makeId=()=>crypto.randomUUID(),timeoutMs=20000,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout,
 captureEditor=getSnapshot,applyRecoveredSnapshot,setEffectiveFrom=()=>{},draftStore=createScheduleRecoveryDraftStore(),onRecovery=()=>{},health={},now=()=>new Date(),saveTimeoutMs=timeoutMs,editorId='editor-'+crypto.randomUUID()}={}){
 let loaded=null,loadedIdentity=null,baseline=null,uiDirty=false,history=false,epoch=0,watchStop=null,watchKey='',saveFlight=null,queuedSave=null,headStamp,requestId=null,followUp=false;const reads=new Map();
 let baselineEffectiveFrom=null,backupQueue=Promise.resolve(),lastBackup=null,backupError='',recoveryCandidates=[],recoveryPlan=null,recoveryEpoch=0,requiresReload=false,lastError=null;
 const scopes=new Map(),restoredSources=new Set(),calendarBackups=new Map();
 const identity=()=>fingerprint(getIdentity()),dirty=()=>uiDirty||baseline!==null&&(fingerprint(getSnapshot())!==baseline||baselineEffectiveFrom!==null&&getEffectiveFrom()!==baselineEffectiveFrom);
 const status=(message,error=false)=>onStatus(message,error);
 const failed=()=>health.isFailed?.()===true;
 const report=error=>{lastError=error;try{health.report?.(error);}catch{}};
 const stop=()=>{const finish=watchStop;watchStop=null;watchKey='';headStamp=undefined;followUp=false;try{finish?.();}catch(error){report(error);}};
 const recoveryState=()=>({preserved:!!lastBackup&&authorize()&&lastBackup.actor===identity()&&lastBackup.month===getMonth()&&scheduleSnapshotFingerprint(getSnapshot())===scheduleSnapshotFingerprint(lastBackup.record.editorSnapshot)&&getEffectiveFrom()===lastBackup.record.effectiveFrom&&(requestId?.id??null)===(lastBackup.record.pending?.revisionId??null),backupError,hasDraft:dirty()||!!requestId,candidates:recoveryCandidates.map(row=>({key:row.key,savedAt:row.savedAt,month:row.month,unconfirmed:!!row.pending,calendarBackup:row.editorId.startsWith('calendar-')})),plan:recoveryPlan?{kind:recoveryPlan.kind,reason:recoveryPlan.reason}:null,failed:failed()});
 const publishRecovery=()=>onRecovery(recoveryState());
 function scope(actor=identity(),value=getIdentity()){let pending=scopes.get(actor);if(!pending){pending=scheduleRecoveryScope(value).catch(error=>{scopes.delete(actor);throw error;});scopes.set(actor,pending);}return pending;}
 const current=(actor,month)=>actor===identity()&&month===getMonth()&&authorize();
 const localBase=()=>({revisionId:getExpectedRevision()??null,snapshotFingerprint:scheduleSnapshotFingerprint(loaded?.editorSnapshot||getSnapshot())});
 async function makeRecord({snapshot=captureEditor(),effectiveFrom=getEffectiveFrom(),pending=requestId?.payload||null,base=localBase(),actor=identity(),actorValue=getIdentity(),month=getMonth()}={}){
  const bound=await scope(actor,actorValue);return {schemaVersion:1,...bound,month,editorId,key:scheduleDraftKey(bound,month,editorId),savedAt:now().toISOString(),editorSnapshot:scheduleDraftSnapshot(snapshot),effectiveFrom,base:clone(base),pending:pending?clone(pending):null};
 }
 async function preserveCalendarBackup(){
  if(!authorize()||!loaded||loadedIdentity!==identity()||loaded.month!==getMonth()||saveFlight)return false;
  const actor=identity(),month=getMonth(),snapshot=clone(captureEditor()),effectiveFrom=getEffectiveFrom(),key=fingerprint({actor,month,snapshot,effectiveFrom});
  try{
   if(calendarBackups.has(key))return true;
   const record=await makeRecord({snapshot,effectiveFrom,pending:null,actor,month});
   record.editorId='calendar-'+crypto.randomUUID();record.key=scheduleDraftKey(record,month,record.editorId);
   const write=backupQueue.catch(()=>{}).then(()=>draftStore.write(record));backupQueue=write;await write;
   calendarBackups.set(key,record.key);return current(actor,month);
  }catch(error){report(error);status('The original calendar draft could not be preserved. Keep the editor open or download it before trying the repair again.',true);return false;}
 }
 function storeRecord(record,actor){
  const write=backupQueue.catch(()=>{}).then(()=>draftStore.write(record));backupQueue=write;
  return write.then(saved=>{if(actor===identity()&&record.month===getMonth()){lastBackup={actor,month:record.month,record:clone(saved)};backupError='';publishRecovery();}return saved;},error=>{if(actor===identity()){lastBackup=null;backupError=error.message||'Local schedule backup was not confirmed.';publishRecovery();}throw error;});
 }
 async function preserveDraft(){
  if(!authorize()||!loaded||loadedIdentity!==identity()||loaded.month!==getMonth())return false;
  const actor=identity(),month=getMonth();
  try{const actorValue=clone(getIdentity()),snapshot=clone(captureEditor()),effectiveFrom=getEffectiveFrom(),pending=requestId?.payload?clone(requestId.payload):null,base=localBase(),record=await makeRecord({actor,actorValue,month,snapshot,effectiveFrom,pending,base});if(!current(actor,month))return false;await storeRecord(record,actor);return current(actor,month);}
  catch(error){if(actor===identity()){backupError=error.message;lastBackup=null;publishRecovery();}return false;}
 }
 async function checkRecovery(view=loaded){
  const token=++recoveryEpoch,actor=identity(),selected=getMonth();recoveryCandidates=[];recoveryPlan=null;
  if(!authorize()||!loaded||loadedIdentity!==actor||loaded.month!==selected){publishRecovery();return;}
  try{const bound=await scope(),rows=await draftStore.list(bound,selected);if(token!==recoveryEpoch||!current(actor,selected))return;recoveryCandidates=rows.filter(row=>row.editorId!==editorId);if(recoveryCandidates[0])recoveryPlan=planScheduleDraftRecovery(recoveryCandidates[0],view,{now:now()});backupError='';}
  catch(error){if(token===recoveryEpoch&&actor===identity())backupError=error.message||'Local recovery could not be checked.';}
  finally{if(token===recoveryEpoch&&actor===identity())publishRecovery();}
 }
 async function recoverDraft(key=recoveryCandidates[0]?.key){
  if(!loaded||loadedIdentity!==identity()||loaded.month!==getMonth()){status('Load this schedule for the signed-in Owner account before restoring a local draft.',true);return false;}
  if(!authorize()||failed()||saveFlight||dirty()||history||isProtected()){status('Keep your current edits or close the active review before restoring a local draft.',true);return false;}
  const actor=identity(),selected=getMonth(),candidate=recoveryCandidates.find(row=>row.key===key);if(!candidate)return false;
  try{
   health.assertReady?.();const view=await read(selected);if(!current(actor,selected)||!isActive())return false;
   const plan=planScheduleDraftRecovery(candidate,view,{now:now()});recoveryPlan=plan;publishRecovery();if(plan.kind==='conflict'){status(plan.reason,true);return false;}
   const pending=plan.kind==='restore'?candidate.pending:null,base={revisionId:view.expectedRevisionId??null,snapshotFingerprint:scheduleSnapshotFingerprint(view.editorSnapshot)};
   const record=await makeRecord({snapshot:candidate.editorSnapshot,effectiveFrom:candidate.effectiveFrom,pending,base,actor,month:selected});if(!current(actor,selected))return false;await storeRecord(record,actor);if(!current(actor,selected))return false;
   await applyView(view);baseline=fingerprint(getSnapshot());baselineEffectiveFrom=getEffectiveFrom();loaded=view;loadedIdentity=actor;setExpectedRevision(view.expectedRevisionId??null);
   if(typeof applyRecoveredSnapshot==='function')await applyRecoveredSnapshot(clone(candidate.editorSnapshot));else await applyView({...view,editorSnapshot:clone(candidate.editorSnapshot)});
   if(!current(actor,selected))return false;setEffectiveFrom(candidate.effectiveFrom);uiDirty=dirty();history=false;requiresReload=false;
   requestId=pending?{id:pending.revisionId,key:null,payload:clone(pending)}:null;restoredSources.add(candidate.key);
   status(plan.kind==='committed'?'The original save is confirmed at HQ. The local editor was restored for review; additional edits have not been saved.':'Local edits restored. Nothing was sent to HQ. Review them before choosing Save.',false);publishRecovery();watch();return true;
  }catch(error){report(error);status(error.message||'The draft could not be restored. It remains on this device.',true);publishRecovery();return false;}
 }
 async function exportDraft(key){if(!authorize()||!loaded||loadedIdentity!==identity()||loaded.month!==getMonth())throw Error('Open this schedule with the signed-in Owner account before downloading a draft.');const actor=identity(),selected=getMonth(),candidate=key&&recoveryCandidates.find(row=>row.key===key),record=candidate||await makeRecord();if(!current(actor,selected))throw Error('The signed-in account or schedule month changed. Reopen its schedule before downloading.');return JSON.stringify(record,null,2);}
 function flushFollowUp(){if(!followUp||reads.has(identity()+'|'+getMonth())||saveFlight||!isActive())return;followUp=false;void load({reason:'live'});}
 function watch(){
  if(failed())return stop();
  if(!loaded||loadedIdentity!==identity()||loaded.month!==getMonth()||!isActive())return stop();const key=identity()+'|'+getMonth();if(watchKey===key)return;
  stop();headStamp=loaded.headSnapshot===undefined?undefined:fingerprint(loaded.headSnapshot);watchKey=key;watchStop=subscribe(getMonth(),event=>{
   if(key!==watchKey||!isActive())return;
   if(event.error){report(event.error);status(failed()?'HQ connection stopped. Save confirmation is unavailable; preserve the draft before reloading.':'Live schedule updates are unavailable. Use Reload saved schedule when connected.',true);publishRecovery();return;}
   if(event.kind==='month'&&(event.revisionId||null)===(getExpectedRevision()||null))return;
   if(event.kind==='head'){if(headStamp===event.stamp)return;headStamp=event.stamp;}
   if(saveFlight){followUp=true;return;}
   if(reads.has(key)){followUp=true;return;}
   void load({reason:'live'});
  })||(()=>{});
 }
 function read(month){
  const key=identity()+'|'+month,previous=reads.get(key);if(previous)return previous.timedOut?Promise.reject(Error('The previous schedule read is still pending. No additional read was started. Retry after it finishes.')):previous.deadline;
  const entry={timedOut:false,promise:Promise.resolve().then(()=>readView(month))};reads.set(key,entry);let timer;
  const cleanup=()=>{if(reads.get(key)===entry)reads.delete(key);if(entry.timedOut)flushFollowUp();};entry.promise.then(cleanup,cleanup);
  entry.deadline=Promise.race([entry.promise,new Promise((_,reject)=>{timer=setTimeoutFn(()=>{entry.timedOut=true;reject(Error('The saved schedule is taking longer than expected. Your editor has not been replaced. Retry after the connection recovers.'));},timeoutMs);})]).finally(()=>clearTimeoutFn(timer));return entry.deadline;
 }
 async function load({month=getMonth(),manual=false,reason='open'}={}){
  if(!authorize())return false;
  if(failed()){status('HQ connection stopped. Keep or download your draft before reloading the app.',true);publishRecovery();return false;}
  if(saveFlight){status('Schedule changes are still saving. Reload after the save finishes.');return false;}
  if((dirty()||history||isProtected())&&!manual){status('A saved schedule update is available. Finish your current edits or review, then choose Reload saved schedule.');watch();return false;}
  if(manual&&isProtected()){status('Close the schedule or swap dialog before reloading.');return false;}
  if(manual&&dirty()&&!history){if(!await confirmDiscard()){status('Your unsaved edits are still in the editor.');return false;}if(!await preserveDraft()){status('The draft backup was not confirmed. Keep the editor open or download its draft before reloading saved data.',true);return false;}}
  const token=++epoch,actor=identity();onLoading(true);status('Loading the saved '+month+' schedule…');
  try{
   health.assertReady?.();const view=await read(month);if(token!==epoch||actor!==identity()||month!==getMonth()||!authorize()||!isActive())return false;
   if(!manual&&(dirty()||history||isProtected())){status('The saved schedule is ready. Your unsaved edits were kept; choose Reload saved schedule when ready.');return false;}
   await applyView(view);if(token!==epoch||actor!==identity())return false;
   setExpectedRevision(view.expectedRevisionId??null);loaded=view;loadedIdentity=actor;baseline=fingerprint(getSnapshot());baselineEffectiveFrom=getEffectiveFrom();uiDirty=false;history=false;requiresReload=false;requestId=null;lastError=null;
   status(view.hasSavedSchedule?'Saved '+month+' schedule loaded from HQ.':'No saved schedule for '+month+' yet.');watch();void checkRecovery(view);return view;
  }catch(error){report(error);if(token===epoch&&actor===identity())status(failed()?'HQ connection stopped. Save confirmation is unavailable. Preserve the draft before reloading.':error.message||'Could not load the saved schedule.',true);publishRecovery();return false;}
  finally{if(token===epoch)onLoading(false);flushFollowUp();}
 }
 function save(){
  if(!authorize())return Promise.resolve(false);
  if(requiresReload){status('The original save reached HQ, but a newer saved schedule needs review. Your local draft is kept; reload and compare before another save.',true);return Promise.resolve(false);}
  if(!loaded||loadedIdentity!==identity()||loaded.month!==getMonth()){status('Load the selected saved schedule for this signed-in account before saving edits.',true);return Promise.resolve(false);}
  if(history){status('Saved historical versions are read-only. Reload the latest saved schedule before editing.',true);return Promise.resolve(false);}
  let snapshot;try{snapshot=clone(captureEditor());}catch(error){status(error.message||'The editor could not be captured. Keep it open.',true);return Promise.resolve(false);}
  const key=fingerprint({actor:identity(),snapshot,effectiveFrom:getEffectiveFrom()});
  if(saveFlight){if(saveFlight.key===key)return saveFlight.promise;if(saveFlight.timedOut){status('The original save is still awaiting confirmation. No duplicate save was started. Your newer edits remain in this editor.',true);void preserveDraft();return Promise.resolve(false);}if(!queuedSave)queuedSave=saveFlight.physical.then(saved=>{queuedSave=null;return saved===true?save():false;},()=>{queuedSave=null;return false;});return queuedSave;}
  let calendar;try{calendar=planScheduleCalendar(snapshot);if(calendar.month!==getMonth())throw Error('The editor month differs from the selected month. Preserve this draft and reload the selected saved schedule before saving.');}catch(error){report(error);status(error.message,true);return Promise.resolve(false);}
  if(calendar.changed){const error=scheduleCalendarError(calendar);report(error);status(error.message,true);return Promise.resolve(false);}
  // A known invalid calendar payload cannot have produced a valid archived
  // revision. Do not keep replaying an old rejected payload after local repair.
  if(requestId&&planScheduleCalendar(requestId.payload.snapshot).changed)requestId=null;
  const actor=identity(),month=getMonth(),actorValue=clone(getIdentity()),effectiveFrom=getEffectiveFrom();
  // An unconfirmed operation is retried unchanged, even if the editor acquired
  // more changes. Those later edits stay separate until the first save is known.
  if(!requestId)requestId={key,id:'owner-schedule-'+makeId(),payload:{snapshot:clone(snapshot),expectedRevisionId:getExpectedRevision()??null,effectiveFrom,revisionId:null}};
  requestId.payload.revisionId=requestId.id;const pending=clone(requestId.payload),before=fingerprint(pending.snapshot),base=localBase();
  const entry={key,promise:null,physical:null,timedOut:false,record:null,cloudStarted:false,cloudConfirmed:null,failUI:null};saveFlight=entry;status('Preserving your schedule draft on this device…');
  entry.physical=(async()=>{
   try{
    const record=await makeRecord({snapshot,effectiveFrom,pending,base,actor,actorValue,month});entry.record=record;if(!current(actor,month))return false;
    await storeRecord(record,actor);if(!current(actor,month))return false;
    health.assertReady?.();if(failed())throw Error('HQ connection stopped.');status('Saving the schedule to HQ…');
    entry.cloudStarted=true;const result=await saveSnapshot(clone(pending.snapshot),{expectedRevisionId:pending.expectedRevisionId,effectiveFrom:pending.effectiveFrom,revisionId:pending.revisionId});entry.cloudConfirmed=result;
    if(actor!==identity()||!authorize())return false;
    const latest=month===getMonth()?clone(captureEditor()):record.editorSnapshot,latestEffective=month===getMonth()?getEffectiveFrom():record.effectiveFrom;
    const acknowledged=result.revision?.snapshot||pending.snapshot,latestRevision=result.latestRevisionId??result.revision?.revisionId??pending.revisionId;
    const more=fingerprint(latest)!==before||latestEffective!==pending.effectiveFrom;
    const confirmed={...record,savedAt:now().toISOString(),editorSnapshot:scheduleDraftSnapshot(latest),effectiveFrom:latestEffective,pending:null,base:{revisionId:pending.revisionId,snapshotFingerprint:scheduleSnapshotFingerprint(acknowledged)}};
    if(more||latestRevision!==pending.revisionId)await storeRecord(confirmed,actor);
    else{const remove=backupQueue.catch(()=>{}).then(async()=>{await draftStore.remove(record.key);for(const source of restoredSources)await draftStore.remove(source);restoredSources.clear();});backupQueue=remove;await remove;if(actor===identity()&&month===getMonth())lastBackup=null;}
    requestId=null;lastError=null;
    if(month!==getMonth()){status('Saved '+month+' to HQ. Reload the selected month before editing it.');publishRecovery();return true;}
    if(latestRevision!==pending.revisionId){requiresReload=true;status('The original save is confirmed at HQ. A newer saved schedule also exists; your local draft is kept for comparison.',true);publishRecovery();return true;}
    setExpectedRevision(result.latestRevisionId??result.revision?.revisionId??null);
    baseline=before;baselineEffectiveFrom=pending.effectiveFrom;uiDirty=more;history=false;loaded={...loaded,editorSnapshot:clone(acknowledged),expectedRevisionId:latestRevision,month};
    await onSaved(result);status(uiDirty?'Saved to shared schedule. Additional unsaved edits remain in this editor.':'Saved to shared schedule. Other Owner devices and staff apps can now load this version.');return true;
   }catch(error){report(error);if(entry.cloudConfirmed){requestId=null;if(actor===identity()&&month===getMonth()){const result=entry.cloudConfirmed,latestRevision=result.latestRevisionId??result.revision?.revisionId??pending.revisionId;if(latestRevision===pending.revisionId){setExpectedRevision(latestRevision);baseline=before;baselineEffectiveFrom=pending.effectiveFrom;uiDirty=fingerprint(getSnapshot())!==before||getEffectiveFrom()!==pending.effectiveFrom;loaded={...loaded,editorSnapshot:clone(result.revision?.snapshot||pending.snapshot),expectedRevisionId:latestRevision,month};}else requiresReload=true;status('The original save is confirmed at HQ. The local backup or screen refresh needs attention; keep any additional edits in this editor.',true);publishRecovery();}return true;}if(!entry.cloudStarted&&requestId?.id===pending.revisionId)requestId=null;if(actor===identity()){if(entry.record){try{const latest=month===getMonth()?clone(captureEditor()):entry.record.editorSnapshot,effective=month===getMonth()?getEffectiveFrom():entry.record.effectiveFrom;await storeRecord({...entry.record,savedAt:now().toISOString(),editorSnapshot:scheduleDraftSnapshot(latest),effectiveFrom:effective,pending:entry.cloudStarted?pending:null},actor);}catch{}}
     status(failed()?'HQ connection stopped. Save confirmation is unavailable. Your draft must be preserved before reloading.':!entry.cloudStarted?'Save was not started because the local backup or connection was not confirmed. Keep this editor open or download the draft.':'Schedule save was not confirmed: '+error.message+(backupError?' Local draft backup also needs attention; keep this editor open.':''),true);publishRecovery();}return false;}
   finally{if(saveFlight===entry)saveFlight=null;publishRecovery();flushFollowUp();}
  })();
  let timer;entry.promise=Promise.race([entry.physical,new Promise(resolve=>{entry.failUI=()=>{entry.timedOut=true;resolve(false);};timer=setTimeoutFn(()=>{entry.timedOut=true;status('Schedule save confirmation is taking longer than expected. The original operation remains pending; no duplicate save will be started.',true);void preserveDraft();resolve(false);},saveTimeoutMs);})]).finally(()=>clearTimeoutFn(timer));return entry.promise;
 }
 async function cloudFailed(){stop();saveFlight?.failUI?.();status('HQ connection stopped. Save confirmation is unavailable. Preserve or download the draft before reloading.',true);await preserveDraft();publishRecovery();}
 return {load,save,start:watch,stop,preserveCalendarBackup,markDirty(){uiDirty=true;lastBackup=null;publishRecovery();void preserveDraft();},preserveDraft,recoverDraft,checkRecovery,exportDraft,cloudFailed,recoveryState,lastError:()=>lastError,isDirty:dirty,isSaving:()=>!!saveFlight,isLoaded:()=>!!loaded,
  setHistory(value){history=value===true;},baseline:()=>loaded,
  invalidate(){++epoch;++recoveryEpoch;stop();loaded=null;loadedIdentity=null;baseline=null;baselineEffectiveFrom=null;uiDirty=false;history=false;requestId=null;lastBackup=null;recoveryCandidates=[];recoveryPlan=null;publishRecovery();}};
}

export function installOwnerScheduleSync(w,d,options){
 const panel=d.getElementById('scheduleMemoryPanel'),view=d.getElementById('view-schedule');
 let message=d.getElementById('ownerScheduleSyncStatus'),reload=d.getElementById('ownerScheduleReload');
 if(!message){const tools=d.createElement('div');tools.className='owner-schedule-sync-tools';message=d.createElement('p');message.id='ownerScheduleSyncStatus';message.setAttribute('role','status');reload=d.createElement('button');reload.id='ownerScheduleReload';reload.type='button';reload.textContent='Reload saved schedule';tools.append(message,reload);panel?.append(tools);}
 const visible=()=>!d.hidden&&view?.classList.contains('active');
 const recovery=d.createElement('section');recovery.className='owner-schedule-recovery';recovery.style.cssText='padding:14px;border:1px solid #cfdbc9;border-radius:10px;background:#f8faf3;margin-top:12px;';
 const recoveryMessage=d.createElement('p');recoveryMessage.id='ownerScheduleRecoveryStatus';recoveryMessage.setAttribute('role','status');recoveryMessage.style.cssText='margin:0 0 10px;font-size:13px;line-height:1.6;';
 const selection=d.createElement('select');selection.id='ownerScheduleRecoverySelection';selection.setAttribute('aria-label','Saved local schedule draft');selection.style.cssText='max-width:100%;padding:9px;margin-bottom:10px;border:1px solid #cbd5c3;border-radius:7px;';
 const controls=d.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px;';
 const button=(id,label)=>{const node=d.createElement('button');node.id=id;node.type='button';node.textContent=label;node.style.cssText='padding:10px 13px;border:1px solid #bbcfbd;background:white;border-radius:7px;font:inherit;font-size:12px;color:#24513c;';controls.append(node);return node;};
 const restore=button('ownerScheduleRestoreDraft','Restore local draft'),download=button('ownerScheduleDownloadDraft','Download draft'),restart=button('ownerScheduleReloadApp','Reload app & recover');
 recovery.append(recoveryMessage,selection,controls);panel?.append(recovery);let recoveryBusy=false;
 const cloudHealth={isFailed:()=>w.managerCloudHealth?.isFailed?.()===true,report:error=>w.managerCloudHealth?.report?.(error),assertReady:()=>w.managerCloudHealth?.assertReady?.()};
 function paintRecovery(state){
  const selected=selection.value;selection.replaceChildren(...state.candidates.map(row=>{const option=d.createElement('option');option.value=row.key;option.textContent=row.month+' · '+new Date(row.savedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})+(row.calendarBackup?' · original calendar backup':row.unconfirmed?' · unconfirmed save':' · local edits');return option;}));if(state.candidates.some(row=>row.key===selected))selection.value=selected;
  selection.hidden=!state.candidates.length;restore.disabled=recoveryBusy||state.failed||!state.candidates.length||controller.isDirty()||controller.isSaving();restart.hidden=!state.failed;restart.disabled=recoveryBusy||!state.preserved;download.disabled=recoveryBusy||!controller.isLoaded();
  recoveryMessage.textContent=state.failed?(state.preserved?'HQ connection stopped. A local draft is preserved. Reload to check HQ and recover it. Restoring never sends another save.':'HQ connection stopped. Local backup has not been confirmed. Keep this editor open or download its draft before reloading.'):state.plan?.kind==='conflict'?state.plan.reason:state.candidates.length?'A local recovery draft is available. Restore checks the latest HQ version first and never saves automatically.':state.backupError?'Local backup is unavailable: '+state.backupError:state.preserved?'Your unsaved schedule draft is preserved on this device.':'Schedule recovery keeps unsaved edits separate from saved HQ versions.';
  options.onRecovery?.(state);
 }
 const controller=createOwnerScheduleSync({...options,isActive:visible,draftStore:options.draftStore||createScheduleRecoveryDraftStore(w.indexedDB??globalThis.indexedDB),health:options.health||cloudHealth,
  setEffectiveFrom:value=>{const input=d.getElementById('scheduleEffectiveFrom');if(input)input.value=value;options.setEffectiveFrom?.(value);},onRecovery:state=>paintRecovery(state),
  isProtected:()=>{const modal=d.getElementById('swapModal');return !!(modal&&modal.style.display!=='none'||w.Swal?.isVisible?.());},
  confirmDiscard:()=>w.ManagerUI.confirm('Reload the saved schedule and discard unsaved edits in this editor?'),
  onStatus:(text,error)=>{if(message){message.textContent=text;message.classList.toggle('is-error',error);message.setAttribute('role',error?'alert':'status');}},
  subscribe:(month,change)=>{
   if(typeof w.onSnapshot!=='function')return ()=>{};const stops=[];
   for(const [id,kind] of [['schedule_month_'+month.replace('-','_'),'month'],['global_schedule','head']])stops.push(w.onSnapshot(w.doc(w.db,'settings',id),{includeMetadataChanges:true},snap=>{const data=snap.exists()?snap.data():null;if(!snap.metadata?.fromCache&&!snap.metadata?.hasPendingWrites)change(kind==='month'?{kind,revisionId:data?.latestRevisionId||null}:{kind,stamp:fingerprint(data)});},error=>change({error})));
   return ()=>stops.forEach(stop=>{try{stop();}catch(error){cloudHealth.report(error);}});
  }});
 reload?.addEventListener('click',()=>void controller.load({manual:true,reason:'reload'}));
 view?.addEventListener('input',event=>{if(!event.target.closest('#scheduleMemoryVersions')&&!['monthSelector','ownerScheduleRecoverySelection'].includes(event.target.id))controller.markDirty();});
 view?.addEventListener('change',event=>{if(!['monthSelector','scheduleMemoryVersions','ownerScheduleRecoverySelection'].includes(event.target.id))controller.markDirty();});
 restore.addEventListener('click',async()=>{if(recoveryBusy)return;recoveryBusy=true;paintRecovery(controller.recoveryState());try{await controller.recoverDraft(selection.value||undefined);}finally{recoveryBusy=false;paintRecovery(controller.recoveryState());}});
 download.addEventListener('click',async()=>{if(recoveryBusy)return;recoveryBusy=true;paintRecovery(controller.recoveryState());try{const json=await controller.exportDraft(selection.hidden?undefined:selection.value),url=w.URL.createObjectURL(new w.Blob([json],{type:'application/json'})),link=d.createElement('a');link.href=url;link.download='TAKODEAL-unsaved-schedule-'+(options.getMonth?.()||'draft')+'.json';d.body.append(link);link.click();link.remove();setTimeout(()=>w.URL.revokeObjectURL(url),1000);}catch(error){recoveryMessage.textContent=error.message||'The draft download could not start. Keep this editor open.';}finally{recoveryBusy=false;paintRecovery(controller.recoveryState());}});
 restart.addEventListener('click',async()=>{if(recoveryBusy)return;recoveryBusy=true;paintRecovery(controller.recoveryState());try{if(await controller.preserveDraft())w.location.reload();else recoveryMessage.textContent='The latest draft backup was not confirmed. Keep the editor open or download the draft; the app was not reloaded.';}finally{recoveryBusy=false;paintRecovery(controller.recoveryState());}});
 const preserveFatal=()=>{void controller.cloudFailed();};w.addEventListener('managercloudfailure',preserveFatal);
 let resumeFlight=null;
 const resume=()=>{if(!visible())return controller.stop();if(resumeFlight)return resumeFlight;resumeFlight=Promise.resolve().then(async()=>{if(visible()){if(cloudHealth.isFailed()){await controller.preserveDraft();paintRecovery(controller.recoveryState());return;}controller.start();await controller.load({reason:'resume'});}}).catch(error=>cloudHealth.report(error)).finally(()=>resumeFlight=null);return resumeFlight;};
 d.addEventListener('visibilitychange',()=>{if(d.hidden)controller.stop();else void resume();});w.addEventListener('pagehide',controller.stop);w.addEventListener('pageshow',()=>void resume());w.addEventListener('online',()=>void resume());
 if(w.MutationObserver&&view){const observer=new w.MutationObserver(()=>{if(!visible())controller.stop();});observer.observe(view,{attributes:true,attributeFilter:['class','style']});}
 paintRecovery(controller.recoveryState());return controller;
}
