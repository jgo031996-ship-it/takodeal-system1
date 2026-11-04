// Staff choices describe a saved slot for management review. They never assign
// a shift, change a punch, waive lateness or authorize clock-out.
import {createScheduleHistoryStore,resolveScheduleForDate,scheduleDateKey} from './schedule-history.js';
import {attendanceMillis,attendanceKind} from './attendance-reconcile.js';
import {shiftTimes,shiftType} from './payroll-safety.js';
const day=86400000,minute=60000;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const stamp=value=>JSON.stringify(canonical(value));
export const staffShiftProposalIdentity=value=>stamp(value??null);
const validId=value=>typeof value==='string'&&!!value&&value.length<=200&&!/[\/\u0000-\u001f]/.test(value);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function context({start,staffId,staffName}={}){
 const at=attendanceMillis(start?.timestamp),name=staffName||start?.staffName,id=staffId||start?.staffId;
 if(!validId(start?.id)||!validId(id)||!name||!validId(start.branch)||!Number.isFinite(at)||attendanceKind(start)!=='TIME IN'||start.deleted||['Voided','Cancelled','Canceled','Deleted'].includes(start.status)||start.staffId&&start.staffId!==id||start.staffName&&start.staffName!==name)throw Error('Reopen the original saved Time In before choosing its plotted shift.');
 return {start,staffId:id,staffName:name,branch:start.branch,at};
}
export function savedShiftChoiceKey(row){return encodeURIComponent(JSON.stringify([row.workDate,row.sourceRevisionId,row.shiftId]));}
export function savedShiftChoices(history,input){
 const ctx=context(input),date=scheduleDateKey(new Date(ctx.at)),midnight=Date.parse(date+'T00:00:00+08:00'),choices=[];
 for(const offset of [-1,0,1]){
  const workDate=scheduleDateKey(new Date(midnight+offset*day)),saved=resolveScheduleForDate(history,workDate),rules=saved?.branchConfig?.[ctx.branch],plotted=saved?.currentSchedule?.[Number(workDate.slice(-2))]?.[ctx.branch]?.scheduled;
  if(!saved?.scheduleRevisionId||!Array.isArray(rules)||!plotted||typeof plotted!=='object'||Array.isArray(plotted))continue;
  const seen=new Set(),duplicate=new Set();for(const rule of rules){if(seen.has(rule.id))duplicate.add(rule.id);seen.add(rule.id);}
  for(const rule of rules){
   if(rule.active===false||!validId(rule.id)||duplicate.has(rule.id)||!Object.hasOwn(plotted,rule.id))continue;
   const {start,end}=shiftTimes(rule);if(start===null||end===null)continue;
   const duration=end-start+(end<=start?1440:0);if(duration<60||duration>1080)continue;
   const begin=Date.parse(workDate+'T00:00:00+08:00')+start*minute,finish=begin+duration*minute;
   // Only a still-running previous-day overnight slot or an imminent next-day
   // slot may cross the original Time In's Philippine date boundary.
   if(offset<0&&!(finish>ctx.at&&begin<=ctx.at)||offset>0&&!(begin>=ctx.at&&begin<=ctx.at+90*minute))continue;
   const row={workDate,branch:ctx.branch,shiftId:rule.id,shiftName:String(rule.name||rule.id),shiftType:shiftType(rule),sourceRevisionId:saved.scheduleRevisionId,expectedStartAt:new Date(begin).toISOString(),expectedEndAt:new Date(finish).toISOString()};
   row.sourceFingerprint=stamp({...row,plotted:plotted[rule.id]??null,amendmentIds:(saved.scheduleAmendments||[]).filter(event=>event.branch===ctx.branch&&event.changes?.some(change=>change.shiftId===rule.id)).map(event=>event.id)});
   if(row.sourceFingerprint.length>12000)throw Error('This plotted shift needs an HQ schedule review.');
   row.key=savedShiftChoiceKey(row);row.distanceMinutes=Math.abs(ctx.at-begin)/minute;choices.push(row);
  }
 }
 choices.sort((a,b)=>a.distanceMinutes-b.distanceMinutes||a.expectedStartAt.localeCompare(b.expectedStartAt)||a.shiftId.localeCompare(b.shiftId));
 return choices.map((row,index)=>({...row,recommended:index===0}));
}
export function makeSavedShiftProposal(history,input,selection){
 const ctx=context(input),choice=savedShiftChoices(history,input).find(row=>row.key===selection?.key);
 if(!choice||choice.sourceFingerprint!==selection.sourceFingerprint)throw Error('The selected plotted shift changed or is no longer saved for this branch and work date. Reload the choices.');
 const {key,distanceMinutes,recommended,...saved}=choice;
 return {schemaVersion:1,referenceOnly:true,staffId:ctx.staffId,staffName:ctx.staffName,timeInLogId:ctx.start.id,...saved};
}
export function validateSavedShiftProposal(history,input,proposal){
 if(!proposal||proposal.schemaVersion!==1||proposal.referenceOnly!==true)throw Error('This staff shift proposal needs a saved plotted reference.');
 const checked=makeSavedShiftProposal(history,input,{key:savedShiftChoiceKey(proposal),sourceFingerprint:proposal.sourceFingerprint});
 if(stamp(checked)!==stamp(proposal))throw Error('The staff shift proposal does not match its original Time In and saved dated slot.');
 return checked;
}
export async function loadSavedShiftChoices(api,input,{read=api.getDocFromServer,assertCurrent=()=>{}}={}){
 const ctx=context(input);if(typeof read!=='function')throw Error('Reconnect to HQ to load the saved dated shifts.');
 const fresh=async reference=>{assertCurrent();const result=await read(reference);assertCurrent();if(!result||typeof result.exists!=='function'||result.metadata?.fromCache===true||result.metadata?.hasPendingWrites===true)throw Error('HQ has not confirmed the saved plotted shifts. Reconnect and retry.');return result;};
 const history=await createScheduleHistoryStore({db:api.db,doc:api.doc,getDocFromServer:fresh}).loadRange(new Date(ctx.at-day),new Date(ctx.at+day));
 assertCurrent();return {history,choices:savedShiftChoices(history,input)};
}
export async function inspectStaffShiftProposal(api,row,{read=api.getDocFromServer,assertCurrent=()=>{}}={}){
 if(!row?.staffShiftProposal)return null;
 const id=row.timeInLogId||row.attendanceLogId;if(!validId(id))throw Error('The shift proposal is not linked to an original Time In.');
 assertCurrent();const snapshot=await read(api.doc(api.db,'attendance_logs',id));assertCurrent();
 if(!snapshot?.exists?.()||snapshot.metadata?.fromCache===true||snapshot.metadata?.hasPendingWrites===true)throw Error('The original Time In could not be confirmed with HQ.');
 const start={...snapshot.data(),id},input={start,staffId:row.staffId||start.staffId,staffName:row.staffName};
 if(row.branch!==start.branch)throw Error('The proposal belongs to a different attendance branch.');
 const {history}=await loadSavedShiftChoices(api,input,{read,assertCurrent});
 return {proposal:validateSavedShiftProposal(history,input,row.staffShiftProposal),start,actualTimeInAt:new Date(attendanceMillis(start.timestamp)).toISOString(),referenceOnly:true};
}
const when=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
export function savedShiftChoicesHTML(choices,{id='staffSavedShiftChoice'}={}){
 if(!choices.length)return '<p class="saved-shift-proposal-note">No dated plotted shifts could be confirmed for this branch. Explain the issue below; management must check the assignment.</p>';
 return '<label for="'+escape(id)+'">Saved plotted shift for management review (optional)</label><select id="'+escape(id)+'" style="width:100%;min-height:44px;margin:8px 0"><option value="">Keep the saved assignment / no proposed change</option>'+choices.map(row=>'<option value="'+escape(row.key)+'">'+escape(row.shiftName)+' · '+escape(when(row.expectedStartAt))+' → '+escape(when(row.expectedEndAt))+(row.recommended?' · closest to Time In':'')+'</option>').join('')+'</select><p class="saved-shift-proposal-note" style="font-size:12px;line-height:1.5">Closest start is a recommendation only. A selected slot is a proposal for Owner review; it does not change your Time In, assigned schedule, lateness or permission to leave.</p>';
}
export function selectedSavedShiftChoice(choices,value){if(!value)return null;const choice=choices.find(row=>row.key===value);if(!choice)throw Error('Choose one of the saved plotted shifts.');return {key:choice.key,sourceFingerprint:choice.sourceFingerprint};}
export function staffShiftProposalHTML(proposal){return proposal?'<section class="staff-shift-proposal"><strong>Staff-proposed saved shift · Owner confirmation required</strong><p>'+escape(proposal.shiftName)+' · '+escape(proposal.branch)+'<br>'+escape(when(proposal.expectedStartAt))+' → '+escape(when(proposal.expectedEndAt))+'</p><small>Reference only. Original punches, assigned schedule and lateness stay unchanged until a separate authorized review.</small></section>':'';}
