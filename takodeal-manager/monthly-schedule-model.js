import {monthKey,scheduleDateKey} from './schedule-history.js';
import {availableSchedulePoolStaff,scheduleIdentityDirectory,resolveScheduleEmployeeReference,mergeScheduleEmployeeAliases} from './schedule-staff-directory.js';
import {activeLeaveDates,leaveStatus} from './leave-model.js';
import {suspensionDates} from './sanction-schedule.js';
import {validateShiftConfig} from './payroll-safety.js';
import {reconcileScheduleLeaveMarkers} from './schedule-leave-markers.js';
import {planScheduleCalendar,calendarReviewWarnings} from './schedule-calendar.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value||{},key);
const named=value=>typeof value==='string'&&value.trim()&&!['N/A','UNFILLED'].includes(value);
const aliases=row=>[row?.name,row?.cashierName,row?.fullName,row?.scheduleNickname,row?.scheduleName,...(row?.scheduleAliases||[])].filter(value=>typeof value==='string');
const nameKey=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const validDate=value=>{try{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}catch{return false;}};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const shiftInterval=(date,shift)=>{
 if(!/^\d{2}:\d{2}$/.test(shift?.startTime)||!/^\d{2}:\d{2}$/.test(shift?.endTime))return null;
 const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),start=Date.parse(date+'T00:00:00Z')+minutes(shift.startTime)*60000;
 let end=Date.parse(date+'T00:00:00Z')+minutes(shift.endTime)*60000;if(end<=start)end+=86400000;return {start,end};
};
function datedAssignments(snapshot,index){
 const result=[];
 for(const [day,branches]of Object.entries(snapshot.currentSchedule||{}))for(const [branch,row]of Object.entries(branches||{}))for(const [shiftId,name]of Object.entries(row?.scheduled||{})){
  if(!named(name))continue;const date=monthKey(snapshot)+'-'+String(day).padStart(2,'0'),shift=snapshot.branchConfig?.[branch]?.find(shift=>shift.id===shiftId);
  result.push({date,branch,shiftId,name,ids:index.ids(name),interval:shiftInterval(date,shift)});
 }
 return result;
}
const overlaps=(a,b)=>a&&b&&a.start<b.end&&b.start<a.end;
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
const boundedText=(value,length)=>typeof value==='string'?value.trim().slice(0,length):'';
const sourceRecordId=value=>typeof value==='string'&&value.length>0&&new TextEncoder().encode(value).length<=1500&&!/[\/\0]/.test(value)?value:'';
function protectionIssue(kind,row,dates,reason){
 const details={kind,id:sourceRecordId(row.id),staffName:boundedText(row.staffName||row.name,200),branch:boundedText(row.branch,120),dates:(dates||[]).slice(0,31).map(date=>boundedText(date,24)),reason};
 const error=Error((kind==='leave'?'Approved leave':'Suspension')+' needs review: '+(details.staffName||'Staff name not recorded')+' · '+(details.branch||'Branch not recorded')+' · '+(details.dates.join(', ')||'Date details need review')+' · Reference: '+(details.id||'not recorded')+'. '+reason);error.scheduleReviewIssue=details;return error;
}
function outsideLeaveWindow(row,from,to){
 if(row.activeLeaveDates!==undefined)return Array.isArray(row.activeLeaveDates)&&(row.activeLeaveDates.length===0||row.activeLeaveDates.every(date=>validDate(date)&&(date<from||date>to)));
 if(/^cancelled$|^canceled$/i.test(String(row.leaveState||'').trim()))return true;
 return validDate(row.startDate)&&validDate(row.endDate)&&row.startDate<=row.endDate&&(row.endDate<from||row.startDate>to);
}
function protectedDates({approvedLeaves,sanctions,directory,snapshot,branch,from,to}){
 const byDate=new Map(),index=identityIndex(directory),refs=new Map(),selectedBranch=nameKey(branch),knownBranches=new Set([...Object.keys(snapshot.branchConfig||{}),...directory.map(person=>person.branch)].map(nameKey).filter(name=>name&&!['unassigned','unknown','all','all branches'].includes(name)));
 const add=(date,row)=>{const list=byDate.get(date)||[];list.push(row);byDate.set(date,list);};
 for(let at=new Date(from+'T12:00:00Z');at.toISOString().slice(0,10)<=to;at.setUTCDate(at.getUTCDate()+1)){
  const date=at.toISOString().slice(0,10),day=snapshot.currentSchedule?.[Number(date.slice(-2))]?.[branch],ids=new Set(),names=new Set();
  const take=value=>{index.ids(value).forEach(id=>ids.add(id));const name=object(value)?value.name||value.staffName||value.cashierName:value;if(named(name))names.add(nameKey(name));};
  Object.values(day?.scheduled||{}).forEach(take);(day?.rest||[]).forEach(take);(day?.unavailable||[]).forEach(take);refs.set(date,{ids,names});
 }
 const selectedDates=[...refs.keys()],eligible=person=>person?.scheduleEligible===true&&person.active!==false;
 function recipient(kind,row,dates){
  const nameIds=index.ids({staffName:row.staffName||row.name}),hasId=row.staffId!==undefined&&row.staffId!==null&&row.staffId!=='',person=hasId?index.byId.get(row.staffId):null,candidates=hasId?(person?[person]:[]):nameIds.map(id=>index.byId.get(id)).filter(Boolean);
  const working=dates.length?dates:selectedDates,dated=(candidate,rawName=row.staffName||row.name)=>working.some(date=>{const ref=refs.get(date);return ref&&(candidate&&ref.ids.has(candidate.staffId)||rawName&&ref.names.has(nameKey(rawName))||candidate&&aliases(candidate).some(name=>ref.names.has(nameKey(name))));});
  // A known inactive recipient must never be rebound to a newer namesake.
  if(person&&!eligible(person)){if(!dated(person))return null;throw protectionIssue(kind,row,working,'This archived or inactive employee is still referenced in the selected roster. Review that dated assignment; no recipient was guessed.');}
  if(!hasId&&candidates.length&&candidates.every(candidate=>!eligible(candidate))){if(!candidates.some(candidate=>dated(candidate)))return null;throw protectionIssue(kind,row,working,'Only archived or inactive accounts match a name still used in the selected roster. Review that dated assignment.');}
  const touchesSelected=candidate=>eligible(candidate)&&(nameKey(candidate.branch)===selectedBranch||dated(candidate));
  const savedBranch=nameKey(row.branch),definitelyOther=savedBranch&&savedBranch!==selectedBranch&&knownBranches.has(savedBranch);
  const relevant=candidates.some(touchesSelected)||nameIds.some(id=>touchesSelected(index.byId.get(id)))||dated(null)||!candidates.length&&!definitelyOther;
  if(!relevant)return null;
  if(hasId&&!person)throw protectionIssue(kind,row,working,'The saved employee ID is missing from the current directory. Link the original employee record; a same-named active account was not selected.');
  if(hasId&&nameIds.length&&!nameIds.includes(person.staffId))throw protectionIssue(kind,row,working,'The saved employee ID and staff name point to different accounts. Confirm the original leave or suspension identity.');
  if(!hasId&&candidates.length!==1)throw protectionIssue(kind,row,working,'The saved name does not identify exactly one employee account. Confirm the original record before preparing these work dates.');
  return hasId?person:candidates[0];
 }
 for(const row of approvedLeaves){
  if(row.type!=='Leave'||row.status!=='Approved'||outsideLeaveWindow(row,from,to))continue;
  let dates;try{dates=activeLeaveDates(row).filter(date=>date>=from&&date<=to);}catch{if(recipient('leave',row,[]))throw protectionIssue('leave',row,[row.startDate,row.endDate].filter(value=>typeof value==='string'),'The active leave dates cannot be verified. Review the saved dates before preparing this roster.');continue;}
  if(!dates.length)continue;const person=recipient('leave',row,dates);if(!person)continue;for(const date of dates)add(date,{name:person.name,staffId:person.staffId,status:row.leaveType||'Leave',...(row.id?{leaveRequestId:row.id}:{})});
 }
 for(const row of sanctions){const dates=suspensionDates(row).filter(date=>date>=from&&date<=to);if(!dates.length)continue;const person=recipient('suspension',row,dates);if(!person)continue;for(const date of dates)add(date,{name:person.name,staffId:person.staffId,status:'Suspended',...(row.id?{sanctionId:row.id}:{})});}
 return byDate;
}

/** Local draft only. Named assignments, existing swap notes, other branches and
 * earlier work dates are never replaced. IDs remain in the review plan even
 * though existing roster consumers use a saved schedule-name string. */
export function buildMonthlySchedulePlan({snapshot,month,branch,staffProfiles,approvedLeaves=[],sanctions=[],leaveSources=[],today=scheduleDateKey(new Date()),effectiveFrom,mode='prepare'}={}){
 const selected=monthKey(month);if(scheduleDateKey(today)!==today)throw Error('Use the current Philippine work date.');if(!object(snapshot)||monthKey(snapshot)!==selected||!object(snapshot.currentSchedule||{}))throw Error('Load the selected month before creating its roster.');if(selected<today.slice(0,7))throw Error('Earlier schedule months stay in history. Choose the current or a future month.');if(typeof branch!=='string'||!branch.trim()||branch==='Main Office')throw Error('Choose a store branch first.');if(!['prepare','auto'].includes(mode))throw Error('Choose Prepare empty slots or Fill empty slots.');
 const from=effectiveFrom||[today,selected+'-01'].sort().at(-1);scheduleDateKey(from);if(from.slice(0,7)!==selected||from<today)throw Error('Choose an effective date in this month, today or later.');
 const count=new Date(Date.UTC(Number(selected.slice(0,4)),Number(selected.slice(5,7)),0)).getUTCDate();if(count<28||count>31)throw Error('Choose a valid schedule month.');const to=selected+'-'+String(count).padStart(2,'0'),rules=rulesFor(snapshot,branch);
 const profiles=validateRows(staffProfiles,'current staff directory',2000),directory=scheduleIdentityDirectory(profiles,snapshot.employees||[]),index=identityIndex(directory);validateRows(approvedLeaves,'approved leave records');validateRows(sanctions,'reviewed suspension records');
 const originalSnapshot=snapshot,calendarRepair=planScheduleCalendar(snapshot);snapshot=calendarRepair.snapshot;
 const recovered=reconcileScheduleLeaveMarkers({snapshot,branch,from,to,staffProfiles:profiles,leaveSources});
 const protection=protectedDates({approvedLeaves,sanctions,directory,snapshot:recovered.snapshot,branch,from,to}),output=recovered.snapshot;output.currentSchedule||={};output.employees=mergeScheduleEmployeeAliases(profiles,snapshot.employees||[]);const assignments=[],warnings=[],conflicts=[],days=[],counts={datesPrepared:0,slotsCreated:0,slotsActivated:0,existingAssignments:0,autoAssigned:0,unfilled:0,standby:0,unavailable:0,untouchedPastDates:0};
 const warning=text=>{if(warnings.length<40&&!warnings.includes(text))warnings.push(text);},loads=new Map();
 for(const text of calendarReviewWarnings(calendarRepair))warning(text);
 for(const release of recovered.released)warning(release.date+': '+release.staffName+' · '+release.reason+' · Reference: '+release.leaveRequestId+'. The linked marker will be released only in this local draft.');
 for(const branches of Object.values(snapshot.currentSchedule||{}))for(const name of Object.values(branches?.[branch]?.scheduled||{})){const person=named(name)&&resolveScheduleEmployeeReference(name,directory);if(person)loads.set(person.staffId,(loads.get(person.staffId)||0)+1);}
 for(let number=1;number<=count;number++){
  const date=selected+'-'+String(number).padStart(2,'0');if(date<from){counts.untouchedPastDates++;continue;}
  const oldBranches=output.currentSchedule[number]||{},old=oldBranches[branch];if(old!==undefined&&!object(old))throw Error(date+': the saved branch row needs review.');
  const row=old?copy(old):{scheduled:{},rest:[],unavailable:[],swaps:{}};if(!object(row.scheduled||{})||Object.values(row.scheduled||{}).some(value=>value!=null&&typeof value!=='string')||!Array.isArray(row.rest||[])||(row.rest||[]).some(value=>typeof value!=='string')||!Array.isArray(row.unavailable||[])||(row.unavailable||[]).some(value=>!object(value))||!object(row.swaps||{}))throw Error(date+': the saved roster details need review.');row.scheduled||={};row.rest||=[];row.unavailable||=[];row.swaps||={};
  const flags=output.unavailability?.[date]||{};if(!object(flags))throw Error(date+': the saved time-off flags need review.');
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
   const existing=datedAssignments(output,index);
   for(const shift of rules){if(row.scheduled[shift.id]!=='UNFILLED')continue;pool.sort((a,b)=>(loads.get(a.staffId)||0)-(loads.get(b.staffId)||0)||a.staffId.localeCompare(b.staffId));const interval=shiftInterval(date,shift),at=pool.findIndex(person=>!existing.some(saved=>saved.ids.includes(person.staffId)&&(overlaps(saved.interval,interval)||!saved.interval&&Math.abs(Date.parse(saved.date)-Date.parse(date))<=86400000)));if(at<0)continue;const [person]=pool.splice(at,1);row.scheduled[shift.id]=person.name;loads.set(person.staffId,(loads.get(person.staffId)||0)+1);const assignment={date,shiftId:shift.id,shiftName:shift.name||shift.id,staffId:person.staffId,staffName:person.name,startTime:shift.startTime,endTime:shift.endTime};assignments.push(assignment);summary.autoAssignments.push(assignment);counts.autoAssigned++;row.rest=row.rest.filter(name=>!index.ids(name).includes(person.staffId));}
  }
  const assignedIds=new Set(Object.values(row.scheduled).filter(named).flatMap(index.ids));
  row.rest=row.rest.filter(name=>{const ids=index.ids(name);return !ids.some(id=>assignedIds.has(id)||blocked.has(id));});
  const represented=new Set(row.rest.flatMap(index.ids));for(const person of pool)if(!assignedIds.has(person.staffId)&&!represented.has(person.staffId)){row.rest.push(person.name);represented.add(person.staffId);}
  for(const shift of rules){const value=row.scheduled[shift.id];if(value==='UNFILLED')counts.unfilled++;summary.slots.push({shiftId:shift.id,shiftName:shift.name||shift.id,startTime:shift.startTime,endTime:shift.endTime,value});}
  summary.standby=row.rest.length;counts.standby+=row.rest.length;counts.unavailable+=row.unavailable.length;counts.datesPrepared++;output.currentSchedule[number]={...oldBranches,[branch]:row};days.push(summary);
 }
 const dated=datedAssignments(output,index);
 for(let at=0;at<dated.length;at++)for(const other of dated.slice(at+1)){
  const saved=dated[at],selected=[saved,other].find(row=>row.branch===branch&&row.date>=from&&row.date<=to);
  if(!selected||!saved.ids.some(id=>other.ids.includes(id)))continue;
  if(saved.date===other.date||overlaps(saved.interval,other.interval))conflicts.push({date:selected.date,shiftId:selected.shiftId,staffName:selected.name,reason:'Preserved assignments duplicate a staff account or overlap another shift ('+saved.branch+' '+saved.date+' / '+other.branch+' '+other.date+').'});
 }
 if(conflicts.length)warning('Some preserved assignments conflict with saved leave, suspension or other shifts. Review those dates before saving the draft.');
 return freeze({version:1,mode,month:selected,branch,from,to,snapshot:output,counts,days,assignments,warnings,conflicts,releasedLeaveMarkers:recovered.released,calendarRepair,sourceFingerprint:monthlyScheduleFingerprint(originalSnapshot)});
}
