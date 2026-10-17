import {monthKey,scheduleDateKey,defaultScheduleEffectiveFrom} from './schedule-history.js';
import {installShiftAmendmentUI} from './shift-amendment-ui.js';
const savedVersionTime=value=>{const date=new Date(value);return Number.isFinite(+date)?new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(date)+' PH':'time unavailable';};

// Version navigation never advances the edit revision without applying its data.
export function installScheduleMemoryUI({document,store,getSnapshot,applySnapshot,setExpectedRevision,setReadOnly,requestMonth,onHistory=()=>{},confirmVersionChange=async()=>true}){
 const month=document.getElementById('monthSelector');if(!month||document.getElementById('scheduleMemoryPanel'))return null;
 const panel=document.createElement('section');panel.id='scheduleMemoryPanel';panel.className='schedule-memory-panel';
 panel.innerHTML='<div><strong>Schedule memory</strong><p>Saved versions keep assignments and shift rules for their effective work dates.</p></div><label>Changes effective from<input type="date" id="scheduleEffectiveFrom"></label><label>Saved versions<select id="scheduleMemoryVersions"><option value="">Current editor</option></select></label><button type="button" id="scheduleMemoryLatest">Show latest version</button><p id="scheduleMemoryStatus" role="status"></p>';
 month.closest('div[style*="justify-content: space-between"]')?.after(panel);if(!panel.isConnected)month.parentElement.parentElement.parentElement.after(panel);
 const input=panel.querySelector('#scheduleEffectiveFrom'),versions=panel.querySelector('#scheduleMemoryVersions'),status=panel.querySelector('#scheduleMemoryStatus');let saved=null,generation=0,viewing=false,amendmentUI=null;
 const options=()=>versions.replaceChildren(new Option('Current editor',''),...(saved?.revisions||[]).slice().reverse().map(revision=>new Option('From '+revision.effectiveFrom+' · saved '+savedVersionTime(revision.savedAt),revision.revisionId)));
 const paint=()=>{
  const snapshot=getSnapshot();if(!snapshot.currentYear||!snapshot.currentMonth)return;
  const today=scheduleDateKey(new Date()),selected=monthKey(snapshot);input.min=today;input.max=selected+'-'+String(new Date(Date.UTC(Number(selected.slice(0,4)),Number(selected.slice(5)),0)).getUTCDate()).padStart(2,'0');
  if(!input.value||monthKey(input.value)!==selected)input.value=defaultScheduleEffectiveFrom(snapshot);
  const past=selected<today.slice(0,7),readOnly=past||viewing;input.disabled=readOnly;setReadOnly(readOnly);panel.dataset.readOnly=String(readOnly);
  status.textContent=past?'Saved past months are read-only.':viewing?'Viewing a saved version. Choose Show latest version to continue editing.':saved?.revisions.length?'Saved versions apply from their effective date. Earlier work dates keep their saved history.':'No saved version for this month yet.';
  for(const button of document.querySelectorAll('#view-schedule button[onclick]'))if(/saveManualSchedule|saveShiftConfigChanges|generateSchedule|addNewShiftToBranch|removeShiftFromBranch|moveShiftOrder|addHoliday|addUnavailability|bulkUnavailability|addEmployee|removeEmployee/.test(button.getAttribute('onclick')||''))button.disabled=readOnly;
  amendmentUI?.paint();
 };
 const bindView=view=>{saved=view.archive||{month:view.month,revisions:[],latestRevisionId:view.expectedRevisionId};viewing=false;onHistory(false);options();input.value=defaultScheduleEffectiveFrom(view.editorSnapshot);paint();};
 const recordSaved=result=>{const revision=result.revision;if(revision){saved={...(saved||{}),month:revision.month,latestRevisionId:result.latestRevisionId,latestRevision:revision,revisions:[...(saved?.revisions||[]).filter(row=>row.revisionId!==revision.revisionId),revision]};}viewing=false;onHistory(false);options();paint();};
 const refresh=async()=>{const token=++generation,selected=month.value||monthKey(getSnapshot());try{const archive=await store.loadMonth(selected);if(token!==generation||month.value!==selected)return;saved=archive;options();paint();return archive;}catch(error){if(token===generation)status.textContent='Could not load schedule versions: '+error.message;}};
 const selectMonth=async()=>{if(requestMonth)return requestMonth(month.value);const archive=await refresh();if(!archive)return;if(archive.latestRevision){await applySnapshot(archive.latestRevision.snapshot);setExpectedRevision(archive.latestRevisionId||null);}viewing=false;onHistory(false);paint();};
 versions.onchange=async()=>{if(!versions.value){await selectMonth();return;}const revision=saved?.revisions.find(row=>row.revisionId===versions.value);if(!revision)return;if(!await confirmVersionChange()){versions.value='';return;}await applySnapshot(revision.snapshot);viewing=true;onHistory(true);input.value=revision.effectiveFrom;paint();};
 panel.querySelector('#scheduleMemoryLatest').onclick=selectMonth;month.onchange=selectMonth;
 amendmentUI=installShiftAmendmentUI({document,store,getSnapshot,requestMonth:async selected=>{if(requestMonth)return requestMonth(selected);return selectMonth();},onReload:()=>document.defaultView?.dispatchEvent(new document.defaultView.CustomEvent('schedule-times-amended'))});
 return {refresh,paint,selectMonth,bindView,recordSaved,effectiveFrom:()=>input.value,isViewingHistory:()=>viewing,amendmentUI};
}
