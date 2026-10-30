import {monthKey,scheduleDateKey} from './schedule-history.js';
import {availableSchedulePoolStaff,scheduleIdentityDirectory,resolveScheduleEmployeeReference,mergeScheduleEmployeeAliases} from './schedule-staff-directory.js';
import {activeLeaveDates,leaveStatus} from './leave-model.js';
import {suspensionDates} from './sanction-schedule.js';
import {validateShiftConfig} from './payroll-safety.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const named=value=>typeof value==='string'&&value.trim()&&!['N/A','UNFILLED'].includes(value);
const aliases=row=>[row?.name,row?.cashierName,row?.fullName,row?.scheduleNickname,row?.scheduleName,...(row?.scheduleAliases||[])].filter(value=>typeof value==='string');
const nameKey=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const validDate=value=>{try{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export const monthlyScheduleFingerprint=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

function validateRows(value,label,max=5000){if(!Array.isArray(value)||value.length>max||value.some(row=>!object(row)))throw Error('Reload the '+label+' before creating this month.');return value;}
function rulesFor(snapshot,branch){
 const rules=snapshot.branchConfig?.[branch];if(!Array.isArray(rules)||!rules.length||rules.length>100)throw Error('Open Shift rules and add the branch shifts first.');
 const ids=new Set();for(const shift of rules){if(!object(shift)||typeof shift.id!=='string'||!shift.id||shift.id.length>120||/[\/\0]/.test(shift.id)||['__proto__','constructor','prototype'].includes(shift.id)||ids.has(shift.id))throw Error('Each branch shift needs its own saved ID. Review Shift rules.');ids.add(shift.id);if(typeof shift.active!=='boolean')throw Error('Check which branch shifts are active.');if(!Array.isArray(shift.days)||shift.days.some(day=>!Number.isInteger(day)||day<0||day>6)||new Set(shift.days).size!==shift.days.length)throw Error('Choose valid working weekdays for every branch shift.');validateShiftConfig(shift);}
 const active=rules.filter(shift=>shift.active!==false);if(!active.length)throw Error('Activate at least one branch shift before creating the month.');return active;
}
function identityIndex(directory){
 const names=new Map(),byId=new Map();for(const person of directory){const id=person.staffId;if(!byId.has(id))byId.set(id,person);for(const name of aliases(person)){const key=nameKey(name);if(!key)continue;if(!names.has(key))names.set(key,new Set());names.get(key).add(id);}}
 const ids=reference=>{if(object(reference)&&reference.staffId)return byId.has(reference.staffId)?[reference.staffId]:[];const name=object(reference)?reference.name||reference.staffName||reference.cashierName:reference;if(byId.has(name))return [name];return [...(names.get(nameKey(name))||[])];};return {ids,byId};
}
function protectedDates({approvedLeaves,sanctions,directory,month}){
 const byDate=new Map(),index=identityIndex(directory),add=(date,row)=>{if(date.slice(0,7)!==month)return;const list=byDate.get(date)||[];list.push(row);byDate.set(date,list);};
 for(const row of approvedLeaves){if(row.type!=='Leave'||row.status!=='Approved')continue;const dates=activeLeaveDates(row),ids=index.ids(row);if(!row.staffId&&ids.length!==1)throw Error('An approved leave has an unclear employee identity. Review it before creating the month.');for(const date of dates)for(const id of row.staffId?[row.staffId]:ids){const person=index.byId.get(id);if(person)add(date,{name:person.name,staffId:id,status:row.leaveType||'Leave',...(row.id?{leaveRequestId:row.id}:{})});}}
 for(const row of sanctions){const dates=suspensionDates(row);if(!dates.length)continue;const ids=index.ids(row);if(!row.staffId&&ids.length!==1)throw Error('A suspension has an unclear employee identity. Review it before creating the month.');for(const date of dates)for(const id of row.staffId?[row.staffId]:ids){const person=index.byId.get(id);if(person)add(date,{name:person.name,staffId:id,status:'Suspended',...(row.id?{sanctionId:row.id}:{})});}}
 return byDate;
}

/** Local draft only. Named assignments, existing swap notes, other branches and
 * earlier work dates are never replaced. IDs remain in the review plan even
 * though existing roster consumers use a saved schedule-name string. */
export function buildMonthlySchedulePlan({snapshot,month,branch,staffProfiles,approvedLeaves=[],sanctions=[],today=scheduleDateKey(new Date()),effectiveFrom,mode='prepare'}={}){
 const selected=monthKey(month);if(scheduleDateKey(today)!==today)throw Error('Use the current Philippine work date.');if(!object(snapshot)||monthKey(snapshot)!==selected||!object(snapshot.currentSchedule||{}))throw Error('Load the selected month before creating its roster.');if(selected<today.slice(0,7))throw Error('Earlier schedule months stay in history. Choose the current or a future month.');if(typeof branch!=='string'||!branch.trim()||branch==='Main Office')throw Error('Choose a store branch first.');if(!['prepare','auto'].includes(mode))throw Error('Choose Prepare empty slots or Fill empty slots.');
 const from=effectiveFrom||[today,selected+'-01'].sort().at(-1);scheduleDateKey(from);if(from.slice(0,7)!==selected||from<today)throw Error('Choose an effective date in this month, today or later.');
 const count=new Date(Date.UTC(Number(selected.slice(0,4)),Number(selected.slice(5,7)),0)).getUTCDate();if(count<28||count>31)throw Error('Choose a valid schedule month.');const to=selected+'-'+String(count).padStart(2,'0'),rules=rulesFor(snapshot,branch);
 const profiles=validateRows(staffProfiles,'current staff directory',2000),directory=scheduleIdentityDirectory(profiles,snapshot.employees||[]),index=identityIndex(directory);validateRows(approvedLeaves,'approved leave records');validateRows(sanctions,'reviewed suspension records');
 const protection=protectedDates({approvedLeaves,sanctions,directory,month:selected}),output=copy(snapshot);output.currentSchedule||={};output.employees=mergeScheduleEmployeeAliases(profiles,snapshot.employees||[]);const assignments=[],warnings=[],conflicts=[],days=[],counts={datesPrepared:0,slotsCreated:0,slotsActivated:0,existingAssignments:0,autoAssigned:0,unfilled:0,standby:0,unavailable:0,untouchedPastDates:0};
 const warning=text=>{if(warnings.length<40&&!warnings.includes(text))warnings.push(text);},loads=new Map();
 for(const branches of Object.values(snapshot.currentSchedule||{}))for(const name of Object.values(branches?.[branch]?.scheduled||{})){const person=named(name)&&resolveScheduleEmployeeReference(name,directory);if(person)loads.set(person.staffId,(loads.get(person.staffId)||0)+1);}
 for(let number=1;number<=count;number++){
  const date=selected+'-'+String(number).padStart(2,'0');if(date<from){counts.untouchedPastDates++;continue;}
  const oldBranches=output.currentSchedule[number]||{},old=oldBranches[branch];if(old!==undefined&&!object(old))throw Error(date+': the saved branch row needs review.');
  const row=old?copy(old):{scheduled:{},rest:[],unavailable:[],swaps:{}};if(!object(row.scheduled||{})||Object.values(row.scheduled||{}).some(value=>value!=null&&typeof value!=='string')||!Array.isArray(row.rest||[])||(row.rest||[]).some(value=>typeof value!=='string')||!Array.isArray(row.unavailable||[])||(row.unavailable||[]).some(value=>!object(value))||!object(row.swaps||{}))throw Error(date+': the saved roster details need review.');row.scheduled||={};row.rest||=[];row.unavailable||=[];row.swaps||={};
  const flags=snapshot.unavailability?.[date]||{};if(!object(flags))throw Error(date+': the saved time-off flags need review.');
  const blocked=new Set();const take=reference=>index.ids(reference).forEach(id=>blocked.add(id));
  for(const branches of Object.values(oldBranches))for(const entry of branches?.unavailable||[])take(entry);
  for(const [name,marker]of Object.entries(flags)){if(!marker)continue;take(object(marker)?{...marker,name:marker.name||name}:name);}
  const extra=[...(protection.get(date)||[])];for(const [name,marker]of Object.entries(flags))if(marker){const ids=index.ids(object(marker)?{...marker,name:marker.name||name}:name);for(const id of ids){const person=index.byId.get(id);if(person?.branch===branch)extra.push({name:person.name,staffId:id,status:leaveStatus(marker),...(object(marker)?copy(marker):{})});}}
  for(const entry of extra){take(entry);const person=index.byId.get(entry.staffId);if(person?.branch===branch&&!row.unavailable.some(saved=>saved.staffId===entry.staffId&&saved.status===entry.status&&saved.leaveRequestId===entry.leaveRequestId&&saved.sanctionId===entry.sanctionId))row.unavailable.push(copy(entry));}
  for(const entry of row.unavailable)take(entry);
  const weekday=new Date(date+'T12:00:00Z').getUTCDay();const summary={date,created:!old,slots:[],autoAssignments:[],standby:0,unavailable:row.unavailable.length};
  for(const shift of rules){const before=row.scheduled[shift.id],available=shift.days.includes(weekday);if(named(before)){counts.existingAssignments++;const ids=index.ids(before);if(ids.length!==1)warning(date+': an existing staff name needs identity review; its assignment is preserved.');if(ids.some(id=>blocked.has(id)))conflicts.push({date,shiftId:shift.id,staffName:before,reason:'Existing assignment conflicts with saved leave or suspension.'});if(!available)warning(date+': an existing assignment is on a disabled weekday; it is preserved for review.');}else{if(!own(row.scheduled,shift.id))counts.slotsCreated++;if(available&&before==='N/A')counts.slotsActivated++;row.scheduled[shift.id]=available?'UNFILLED':'N/A';}}
  let pool=availableSchedulePoolStaff({employees:directory,branch,dayData:{...row,rest:[]},dayBranches:Object.fromEntries(Object.entries(oldBranches).filter(([name])=>name!==branch)),unavailability:flags}).filter(person=>!blocked.has(person.staffId));
  pool=pool.filter(person=>{if(person.dateHired&&!validDate(person.dateHired)){warning('A staff hire date needs review; that account is excluded from automatic assignment.');return mode!=='auto';}return !person.dateHired||person.dateHired<=date;});
  if(mode==='auto'){
   for(const shift of rules){if(row.scheduled[shift.id]!=='UNFILLED')continue;pool.sort((a,b)=>(loads.get(a.staffId)||0)-(loads.get(b.staffId)||0)||a.staffId.localeCompare(b.staffId));const person=pool.shift();if(!person)break;row.scheduled[shift.id]=person.name;loads.set(person.staffId,(loads.get(person.staffId)||0)+1);const assignment={date,shiftId:shift.id,shiftName:shift.name||shift.id,staffId:person.staffId,staffName:person.name,startTime:shift.startTime,endTime:shift.endTime};assignments.push(assignment);summary.autoAssignments.push(assignment);counts.autoAssigned++;row.rest=row.rest.filter(name=>!index.ids(name).includes(person.staffId));}
  }
  const assignedIds=new Set(Object.values(row.scheduled).filter(named).flatMap(index.ids));
  row.rest=row.rest.filter(name=>{const ids=index.ids(name);return !ids.some(id=>assignedIds.has(id)||blocked.has(id));});
  const represented=new Set(row.rest.flatMap(index.ids));for(const person of pool)if(!assignedIds.has(person.staffId)&&!represented.has(person.staffId)){row.rest.push(person.name);represented.add(person.staffId);}
  for(const shift of rules){const value=row.scheduled[shift.id];if(value==='UNFILLED')counts.unfilled++;summary.slots.push({shiftId:shift.id,shiftName:shift.name||shift.id,startTime:shift.startTime,endTime:shift.endTime,value});}
  summary.standby=row.rest.length;counts.standby+=row.rest.length;counts.unavailable+=row.unavailable.length;counts.datesPrepared++;output.currentSchedule[number]={...oldBranches,[branch]:row};days.push(summary);
 }
 if(conflicts.length)warning('Some preserved assignments conflict with saved leave or suspension. Review those dates before saving the draft.');
 return freeze({version:1,mode,month:selected,branch,from,to,snapshot:output,counts,days,assignments,warnings,conflicts,sourceFingerprint:monthlyScheduleFingerprint(snapshot)});
}
