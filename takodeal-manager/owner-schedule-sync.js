const clone=value=>structuredClone(value);
const fingerprint=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
/** Owns only the editor's read/save lifecycle. It never changes schedule rules. */
export function createOwnerScheduleSync({readView,applyView,getSnapshot,getMonth,getIdentity,authorize=()=>true,getExpectedRevision,setExpectedRevision,getEffectiveFrom,saveSnapshot,
 isActive=()=>true,isProtected=()=>false,confirmDiscard=async()=>false,subscribe=()=>()=>{},onStatus=()=>{},onSaved=()=>{},onLoading=()=>{},makeId=()=>crypto.randomUUID(),timeoutMs=20000,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}={}){
 let loaded=null,loadedIdentity=null,baseline=null,uiDirty=false,history=false,epoch=0,watchStop=null,watchKey='',saveFlight=null,queuedSave=null,headStamp,requestId=null,followUp=false;const reads=new Map();
 const identity=()=>fingerprint(getIdentity()),dirty=()=>uiDirty||baseline!==null&&fingerprint(getSnapshot())!==baseline;
 const status=(message,error=false)=>onStatus(message,error);
 const stop=()=>{watchStop?.();watchStop=null;watchKey='';headStamp=undefined;followUp=false;};
 function flushFollowUp(){if(!followUp||reads.has(identity()+'|'+getMonth())||saveFlight||!isActive())return;followUp=false;void load({reason:'live'});}
 function watch(){
  if(!loaded||loadedIdentity!==identity()||loaded.month!==getMonth()||!isActive())return stop();const key=identity()+'|'+getMonth();if(watchKey===key)return;
  stop();headStamp=loaded.headSnapshot===undefined?undefined:fingerprint(loaded.headSnapshot);watchKey=key;watchStop=subscribe(getMonth(),event=>{
   if(key!==watchKey||!isActive())return;
   if(event.error){status('Live schedule updates are unavailable. Use Reload saved schedule when connected.',true);return;}
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
  if(saveFlight){status('Schedule changes are still saving. Reload after the save finishes.');return false;}
  if((dirty()||history||isProtected())&&!manual){status('A saved schedule update is available. Finish your current edits or review, then choose Reload saved schedule.');watch();return false;}
  if(manual&&isProtected()){status('Close the schedule or swap dialog before reloading.');return false;}
  if(manual&&dirty()&&!history&&!await confirmDiscard()){status('Your unsaved edits are still in the editor.');return false;}
  const token=++epoch,actor=identity();onLoading(true);status('Loading the saved '+month+' schedule…');
  try{
   const view=await read(month);if(token!==epoch||actor!==identity()||month!==getMonth()||!authorize()||!isActive())return false;
   if(!manual&&(dirty()||history||isProtected())){status('The saved schedule is ready. Your unsaved edits were kept; choose Reload saved schedule when ready.');return false;}
   await applyView(view);if(token!==epoch||actor!==identity())return false;
   setExpectedRevision(view.expectedRevisionId??null);loaded=view;loadedIdentity=actor;baseline=fingerprint(getSnapshot());uiDirty=false;history=false;
   status(view.hasSavedSchedule?'Saved '+month+' schedule loaded from HQ.':'No saved schedule for '+month+' yet.');watch();return view;
  }catch(error){if(token===epoch&&actor===identity())status(error.message||'Could not load the saved schedule.',true);return false;}
  finally{if(token===epoch)onLoading(false);flushFollowUp();}
 }
 function save(){
  if(!authorize())return Promise.resolve(false);
  if(!loaded||loadedIdentity!==identity()||loaded.month!==getMonth()){status('Load the selected saved schedule for this signed-in account before saving edits.',true);return Promise.resolve(false);}
  if(history){status('Saved historical versions are read-only. Reload the latest saved schedule before editing.',true);return Promise.resolve(false);}
  const snapshot=clone(getSnapshot()),key=fingerprint({actor:identity(),snapshot,effectiveFrom:getEffectiveFrom()});
  if(saveFlight){if(saveFlight.key===key)return saveFlight.promise;if(!queuedSave)queuedSave=saveFlight.promise.then(()=>{queuedSave=null;return save();},()=>{queuedSave=null;return save();});return queuedSave;}
  const actor=identity(),month=getMonth(),before=fingerprint(snapshot),effectiveFrom=getEffectiveFrom();
  if(!requestId||requestId.key!==key)requestId={key,id:'owner-schedule-'+makeId()};
  const entry={key,promise:null};saveFlight=entry;status('Saving the schedule to HQ…');
  entry.promise=(async()=>{
   try{
    const result=await saveSnapshot(snapshot,{expectedRevisionId:getExpectedRevision(),effectiveFrom,revisionId:requestId.id});
    if(actor!==identity()||!authorize())return false;
    if(month!==getMonth()){status('Saved '+month+' to HQ. Reload the selected month before editing it.');return true;}
    setExpectedRevision(result.latestRevisionId??result.revision?.revisionId??null);
    baseline=before;uiDirty=fingerprint(getSnapshot())!==before;history=false;loaded={...loaded,editorSnapshot:clone(result.revision?.snapshot||snapshot),expectedRevisionId:result.latestRevisionId,month};requestId=null;
    await onSaved(result);status(uiDirty?'Saved to HQ. Additional unsaved edits remain in this editor.':'Saved to HQ. Phone schedules will refresh to this saved version.');return true;
   }catch(error){if(actor===identity())status('Schedule not saved: '+error.message,true);return false;}
   finally{if(saveFlight===entry)saveFlight=null;flushFollowUp();}
  })();return entry.promise;
 }
 return {load,save,start:watch,stop,markDirty(){uiDirty=true;},isDirty:dirty,isSaving:()=>!!saveFlight,isLoaded:()=>!!loaded,
  setHistory(value){history=value===true;},baseline:()=>loaded,
  invalidate(){++epoch;stop();loaded=null;loadedIdentity=null;baseline=null;uiDirty=false;history=false;requestId=null;}};
}

export function installOwnerScheduleSync(w,d,options){
 const panel=d.getElementById('scheduleMemoryPanel'),view=d.getElementById('view-schedule');
 let message=d.getElementById('ownerScheduleSyncStatus'),reload=d.getElementById('ownerScheduleReload');
 if(!message){const tools=d.createElement('div');tools.className='owner-schedule-sync-tools';message=d.createElement('p');message.id='ownerScheduleSyncStatus';message.setAttribute('role','status');reload=d.createElement('button');reload.id='ownerScheduleReload';reload.type='button';reload.textContent='Reload saved schedule';tools.append(message,reload);panel?.append(tools);}
 const visible=()=>!d.hidden&&view?.classList.contains('active');
 const controller=createOwnerScheduleSync({...options,isActive:visible,
  isProtected:()=>{const modal=d.getElementById('swapModal');return !!(modal&&modal.style.display!=='none'||w.Swal?.isVisible?.());},
  confirmDiscard:()=>w.ManagerUI.confirm('Reload the saved schedule and discard unsaved edits in this editor?'),
  onStatus:(text,error)=>{if(message){message.textContent=text;message.classList.toggle('is-error',error);message.setAttribute('role',error?'alert':'status');}},
  subscribe:(month,change)=>{
   if(typeof w.onSnapshot!=='function')return ()=>{};const stops=[];
   for(const [id,kind] of [['schedule_month_'+month.replace('-','_'),'month'],['global_schedule','head']])stops.push(w.onSnapshot(w.doc(w.db,'settings',id),{includeMetadataChanges:true},snap=>{const data=snap.exists()?snap.data():null;if(!snap.metadata?.fromCache&&!snap.metadata?.hasPendingWrites)change(kind==='month'?{kind,revisionId:data?.latestRevisionId||null}:{kind,stamp:fingerprint(data)});},error=>change({error})));
   return ()=>stops.forEach(stop=>stop());
  }});
 reload?.addEventListener('click',()=>void controller.load({manual:true,reason:'reload'}));
 view?.addEventListener('input',event=>{if(!event.target.closest('#scheduleMemoryVersions')&&event.target.id!=='monthSelector')controller.markDirty();});
 view?.addEventListener('change',event=>{if(!['monthSelector','scheduleMemoryVersions'].includes(event.target.id))controller.markDirty();});
 let resumeFlight=null;
 const resume=()=>{if(!visible())return controller.stop();if(resumeFlight)return resumeFlight;resumeFlight=Promise.resolve().then(async()=>{if(w.enableNetwork&&w.db)await w.enableNetwork(w.db);if(visible()){controller.start();await controller.load({reason:'resume'});}}).catch(()=>{}).finally(()=>resumeFlight=null);return resumeFlight;};
 d.addEventListener('visibilitychange',()=>{if(d.hidden)controller.stop();else void resume();});w.addEventListener('pagehide',controller.stop);w.addEventListener('pageshow',()=>void resume());w.addEventListener('online',()=>void resume());
 if(w.MutationObserver&&view){const observer=new w.MutationObserver(()=>{if(!visible())controller.stop();});observer.observe(view,{attributes:true,attributeFilter:['class','style']});}
 return controller;
}
