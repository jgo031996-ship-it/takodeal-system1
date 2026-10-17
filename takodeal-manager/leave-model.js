// Leave planning changes availability only. It never edits punches or payroll.
const copy=value=>JSON.parse(JSON.stringify(value));
export const leaveNameKey=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
export function leaveDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose valid leave dates.');const date=new Date(value+'T00:00:00Z');
 if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==value||date.getUTCFullYear()<2000||date.getUTCFullYear()>2199)throw Error('Choose valid leave dates.');return value;
}
export function leaveToday(at=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at),values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return values.year+'-'+values.month+'-'+values.day;}
export function leaveDates(start,end){start=leaveDate(start);end=leaveDate(end);if(start>end)throw Error('End date must be on or after the start date.');const dates=[];for(let day=start;day<=end;){dates.push(day);if(dates.length>93)throw Error('Request at most 93 leave days at once.');const next=new Date(day+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);day=next.toISOString().slice(0,10);}return dates;}
export function activeLeaveDates(request){const dates=request.activeLeaveDates===undefined?leaveDates(request.startDate,request.endDate):request.activeLeaveDates;if(!Array.isArray(dates)||dates.length>186)throw Error('The saved leave dates need management review.');return [...new Set(dates.map(leaveDate))].sort();}
export function leaveFingerprint(value){const normalize=item=>Array.isArray(item)?item.map(normalize):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,normalize(item[key])])):item;return JSON.stringify(normalize(value));}
export function leavePerson(profile,staffId){
 const name=String(profile?.cashierName||'').trim(),branch=String(profile?.branch||'').trim();
 if(!staffId||!name||!branch||profile.active===false||profile.archived===true||profile.deleted===true||/^(?:REVOKED|BLOCKED)$/i.test(String(profile.pin||''))||/^(?:resigned|terminated|inactive|disabled|revoked|archived|blocked|deleted)$/i.test(String(profile.status||'')))throw Error('This active staff profile is missing. Ask management to review the staff account.');
 return {staffId,name,branch,aliases:[...new Set([name,profile.fullName,profile.scheduleNickname,profile.scheduleName,profile.nickname].filter(value=>typeof value==='string'&&value.trim()).map(value=>value.trim()))]};
}
export function leaveStatus(value){return typeof value==='string'?value:typeof value?.status==='string'?value.status:'Leave';}
export function leaveUnavailable(name,value){return {name,status:leaveStatus(value),...(value?.leaveRequestId?{leaveRequestId:value.leaveRequestId,staffId:value.staffId}: {})};}
export function ownedScheduleLeave(snapshot,date,name){const matches=value=>leaveNameKey(value)===leaveNameKey(name),master=Object.entries(snapshot.unavailability?.[date]||{}).find(([value,row])=>matches(value)&&row?.leaveRequestId&&row.staffId)?.[1];if(master)return master;if(snapshot.currentYear!==Number(date.slice(0,4))||snapshot.currentMonth!==Number(date.slice(5,7)))return null;for(const day of Object.values(snapshot.currentSchedule?.[Number(date.slice(-2))]||{})){const row=(day.unavailable||[]).find(row=>matches(row.name)&&row.leaveRequestId&&row.staffId);if(row)return row;}return null;}
export function scheduleUnavailable(flags,name,profiles=[]){const direct=Object.entries(flags||{}).find(([key])=>leaveNameKey(key)===leaveNameKey(name));if(direct)return direct[1];const aliasSet=new Set([leaveNameKey(name)]);for(const profile of profiles){const aliases=[profile.name,profile.cashierName,profile.fullName,profile.scheduleNickname,profile.scheduleName,profile.nickname].filter(Boolean).map(leaveNameKey);if(aliases.includes(leaveNameKey(name)))for(const alias of aliases)aliasSet.add(alias);}const linked=Object.entries(flags||{}).find(([key,value])=>value?.leaveRequestId&&aliasSet.has(leaveNameKey(key)));return linked?.[1]||null;}
export function normalizeLeaveInput(input,{today=leaveToday(),future=true}={}){
 const id=String(input.id||'');if(!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw Error('Reopen the leave request form.');
 const dates=leaveDates(input.startDate,input.endDate),reason=String(input.reason||'').trim(),leaveType=String(input.leaveType||'Leave').trim();
 if(future&&dates[0]<today)throw Error('Choose today or a future leave date. Earlier attendance stays on file.');if(reason.length<3||reason.length>1500||!leaveType||leaveType.length>80)throw Error('Enter a short leave type and reason.');
 return {id,startDate:dates[0],endDate:dates.at(-1),reason,leaveType};
}
export function proposedLeaveDates(parent,input,today=leaveToday()){
 const before=activeLeaveDates(parent),future=before.filter(date=>date>=today);
 if(input.kind==='Cancel'){
  const cancel=input.cancelDates===undefined?future:[...new Set(input.cancelDates.map(leaveDate))].sort();if(!cancel.length||cancel.some(date=>date<today||!future.includes(date)))throw Error('Choose current or future dates from this approved leave.');return {before,after:before.filter(date=>!cancel.includes(date)),removed:cancel,added:[]};
 }
 if(input.kind!=='Dates')throw Error('Choose cancellation or a date change.');const dates=leaveDates(input.startDate,input.endDate);if(dates[0]<today)throw Error('New leave dates must start today or later. Earlier dates stay on file.');
 const after=[...new Set([...before.filter(date=>date<today),...dates])].sort(),removed=before.filter(date=>!after.includes(date)),added=after.filter(date=>!before.includes(date));if(!removed.length&&!added.length)throw Error('The proposed dates are unchanged.');return {before,after,removed,added};
}
export function describeLeaveDates(dates){const groups=[];for(const date of [...new Set(dates)].sort()){const last=groups.at(-1),previous=last?.at(-1),next=previous&&new Date(previous+'T00:00:00Z');if(next)next.setUTCDate(next.getUTCDate()+1);if(last&&next.toISOString().slice(0,10)===date)last.push(date);else groups.push([date]);}return groups.map(group=>group.length===1?group[0]:group[0]+' to '+group.at(-1)).join(' · ')||'No active dates';}

export function projectLeaveDay(snapshot,date,{person,requestId,status='Leave',activate=true,assertBranch=()=>true}={}){
 leaveDate(date);const result=copy(snapshot),day=Number(date.slice(-2)),names=new Set(person.aliases.map(leaveNameKey)),matches=name=>names.has(leaveNameKey(name)),owned=row=>row?.leaveRequestId===requestId&&row.staffId===person.staffId;
 if(result.currentYear!==Number(date.slice(0,4))||result.currentMonth!==Number(date.slice(5,7)))throw Error('The leave date does not belong to this schedule month.');
 result.currentSchedule||={};result.currentSchedule[day]||={};result.unavailability||={};
 const flags=result.unavailability[date]||{},flagNames=Object.keys(flags).filter(matches),effect={date,changedBranches:[],removedAssignments:[],standbyBranches:[],preservedFlags:[]};
 if(activate&&flagNames.some(name=>!owned(flags[name])))throw Error(date+': this staff member already has another leave, day off or unavailable flag. Review it first.');
 const branches=new Set([person.branch,...Object.entries(result.currentSchedule[day]).filter(([,data])=>Object.values(data.scheduled||{}).some(matches)||(data.rest||[]).some(matches)||(data.unavailable||[]).some(row=>matches(row.name)||owned(row))).map(([branch])=>branch)]);
 for(const branch of branches){
  const existing=result.currentSchedule[day][branch],hasOwn=(existing?.unavailable||[]).some(owned);
  if(!activate&&!hasOwn&&!(branch===person.branch&&flagNames.some(name=>owned(flags[name]))))continue;
  if(assertBranch(branch)!==true)throw Error(date+': this staff member is also assigned to '+branch+'. An authorized reviewer must include that branch.');
  const data=result.currentSchedule[day][branch]||={scheduled:{},rest:[],unavailable:[],swaps:{}};data.scheduled||={};data.rest||=[];data.unavailable||=[];data.swaps||={};
  const foreign=data.unavailable.filter(row=>matches(row.name)&&!owned(row));
  if(activate&&foreign.length)throw Error(date+': '+branch+' already has another leave or day-off flag for this staff member.');
  if(activate){
   for(const [shiftId,name]of Object.entries(data.scheduled))if(matches(name)){effect.removedAssignments.push({branch,shiftId,name});data.scheduled[shiftId]='UNFILLED';delete data.swaps[shiftId];}
   data.rest=data.rest.filter(name=>!matches(name));data.unavailable=data.unavailable.filter(row=>!owned(row));data.unavailable.push({name:person.name,status,leaveRequestId:requestId,staffId:person.staffId});
  }else{
   data.unavailable=data.unavailable.filter(row=>!owned(row));
   const hasAssigned=Object.values(data.scheduled).some(matches),hasOtherFlag=data.unavailable.some(row=>matches(row.name))||flagNames.some(name=>!owned(flags[name]));
   if(!hasAssigned&&!hasOtherFlag&&!data.rest.some(matches)){data.rest.push(person.name);effect.standbyBranches.push(branch);}
   if(hasOtherFlag)effect.preservedFlags.push(branch);
  }
  effect.changedBranches.push(branch);
 }
 if(activate){result.unavailability[date]={...flags};for(const name of flagNames)delete result.unavailability[date][name];result.unavailability[date][person.name]={status,leaveRequestId:requestId,staffId:person.staffId};}
 else{for(const name of flagNames)if(owned(flags[name]))delete flags[name];if(Object.keys(flags).length)result.unavailability[date]=flags;else delete result.unavailability[date];}
 return {snapshot:result,effect};
}
