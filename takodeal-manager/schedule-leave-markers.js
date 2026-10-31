import {activeLeaveDates,leaveNameKey} from './leave-model.js';
import {scheduleIdentityDirectory} from './schedule-staff-directory.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const validId=value=>typeof value==='string'&&value.length>0&&!['.','..'].includes(value)&&!/[\/\0]/.test(value)&&new TextEncoder().encode(value).length<=1500;
const aliases=person=>[person.name,person.cashierName,person.fullName,person.scheduleNickname,person.scheduleName,...(person.scheduleAliases||[])].filter(Boolean).map(leaveNameKey);

// Only saved, explicitly linked markers can be released. Manual Day Off and
// suspension flags have independent provenance and must remain untouched.
export function scheduleLeaveMarkerIds(snapshot,{branch,from,to}={}){
 const ids=new Set();
 for(const [number,branches]of Object.entries(snapshot?.currentSchedule||{})){
  const date=String(snapshot.currentYear)+'-'+String(snapshot.currentMonth).padStart(2,'0')+'-'+String(number).padStart(2,'0');
  if(date<from||date>to)continue;
  for(const marker of branches?.[branch]?.unavailable||[])if(validId(marker?.leaveRequestId))ids.add(marker.leaveRequestId);
 }
 for(const [date,flags]of Object.entries(snapshot?.unavailability||{}))if(date>=from&&date<=to)for(const marker of Object.values(flags||{}))if(validId(marker?.leaveRequestId))ids.add(marker.leaveRequestId);
 if(ids.size>500)throw Error('Too many saved leave markers need review. Review a smaller date range first.');
 return [...ids].sort();
}

export function savedLeaveActiveOn(record,date){
 if(record===null)return false;
 if(record?.type!=='Leave')throw Error('The linked record is no longer a leave request. Review its saved reference.');
 if(['Rejected','Withdrawn','Cancelled','Canceled'].includes(record.status))return false;
 if(record.status!=='Approved')throw Error('The linked leave decision needs review before releasing this roster marker.');
 if(record.activeLeaveDates===undefined&&/^cancelled$|^canceled$/i.test(String(record.leaveState||'').trim()))return false;
 return activeLeaveDates(record).includes(date);
}

/** Pure proposal: reading or cancelling this review never edits saved data. */
export function reconcileScheduleLeaveMarkers({snapshot,branch,from,to,staffProfiles,leaveSources=[]}){
 const output=copy(snapshot),directory=scheduleIdentityDirectory(staffProfiles,snapshot.employees),sources=new Map(leaveSources.map(source=>[source.id,source.record])),released=[];
 const check=(marker,name,date)=>{
  if(!marker?.leaveRequestId||!sources.has(marker.leaveRequestId))return false;
  const record=sources.get(marker.leaveRequestId),person=directory.find(person=>person.staffId===marker.staffId);
  const matches=value=>directory.filter(person=>aliases(person).includes(leaveNameKey(value)));
  const fail=()=>{throw Error(date+': saved leave '+marker.leaveRequestId+' has an unconfirmed employee identity. Review the original employee ID; no marker was released.');};
  if(!person||matches(name).length!==1||!aliases(person).includes(leaveNameKey(name)))return fail();
  if(record!==null){
   if(record.staffId&&record.staffId!==person.staffId)return fail();
   if(!record.staffId&&(!record.staffName||matches(record.staffName).length!==1||!aliases(person).includes(leaveNameKey(record.staffName))))return fail();
   if(record.staffName&&matches(record.staffName).some(other=>other.staffId!==person.staffId))return fail();
  }
  if(savedLeaveActiveOn(record,date))return false;
  released.push({date,staffId:person.staffId,staffName:person.name,leaveRequestId:marker.leaveRequestId,reason:record===null?'Saved leave no longer exists':'Leave is no longer active on this date'});
  return true;
 };
 for(let at=new Date(from+'T12:00:00Z');at.toISOString().slice(0,10)<=to;at.setUTCDate(at.getUTCDate()+1)){
  const date=at.toISOString().slice(0,10),day=output.currentSchedule?.[Number(date.slice(-2))]?.[branch];
  const referenced=new Set([...(day?.rest||[]),...Object.values(day?.scheduled||{}),...(day?.unavailable||[]).map(row=>row.name)].map(leaveNameKey));
  if(day)day.unavailable=(day.unavailable||[]).filter(marker=>!check(marker,marker.name,date));
  const flags=output.unavailability?.[date];
  for(const [name,marker]of Object.entries(flags||{})){
   const person=directory.find(person=>person.staffId===marker?.staffId);
   if(person&&(person.branch===branch||aliases(person).some(name=>referenced.has(name)))&&check(marker,name,date))delete flags[name];
  }
  if(flags&&!Object.keys(flags).length)delete output.unavailability[date];
 }
 const unique=[...new Map(released.map(row=>[JSON.stringify([row.date,row.staffId,row.leaveRequestId]),row])).values()];
 return {snapshot:output,released:unique};
}

// Keep the synchronous roster guard blocking while a separate fresh review
// opens. It never removes a marker or writes to any business collection.
export async function openSavedScheduleLeave(w,{marker,date,isCurrent=()=>true}){
 try{
  if(typeof w.getDocFromServer!=='function'||!validId(marker.leaveRequestId))throw Error('Reconnect to HQ and review the saved leave reference.');
  const saved=await w.getDocFromServer(w.doc(w.db,'staff_requests',marker.leaveRequestId));
  if(!isCurrent())return;
  if(saved.metadata?.fromCache||saved.metadata?.hasPendingWrites)throw Error('Reconnect to HQ before reviewing this leave marker.');
  const record=saved.exists()?saved.data():null;
  if(savedLeaveActiveOn(record,date)){await w.getManagerLeaveUI().change(marker.leaveRequestId,'Cancel',{date});return;}
  w.ManagerUI.notify('This saved leave is no longer active on '+date+'. Review Create Monthly Schedule to release its stale marker in a local draft, then use Save Edits.');
  await w.openMonthlySchedule();
 }catch(error){if(isCurrent())w.ManagerUI.notify(error.message||'The saved leave could not be confirmed. Reconnect and retry.');}
}
