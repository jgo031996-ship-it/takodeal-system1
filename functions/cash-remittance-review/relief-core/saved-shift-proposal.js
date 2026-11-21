// Staff choices describe a saved slot for management review. They never assign
// a shift, change a punch, waive lateness or authorize clock-out.
import {createScheduleHistoryStore,resolveScheduleForDate,scheduleDateKey} from './schedule-history.js';
import {attendanceMillis,attendanceKind} from './attendance-reconcile.js';
import {shiftTimes,shiftType} from './shift-clock.js';
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
