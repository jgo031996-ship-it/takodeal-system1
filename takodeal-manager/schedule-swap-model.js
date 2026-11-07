// Dated roster selection only. No profile, home branch, punch or pay is changed.
import {activeStaffProfile} from './staff-lifecycle-model.js';

export const SWAP_PENDING_STATUS='Pending Staff Acceptance';
export const SWAP_REVIEW_STATUS='Awaiting HQ Review';
export const SWAP_REQUEST_VERSION=2;

const copy=value=>JSON.parse(JSON.stringify(value));
const text=value=>typeof value==='string'?value.trim():'';
const key=value=>text(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const personName=value=>!!key(value)&&!['n/a','unfilled','standby','-'].includes(key(value));
const aliases=row=>[row?.name,row?.fullName,row?.cashierName,row?.scheduleNickname,row?.scheduleName,row?.nickname,...(Array.isArray(row?.scheduleAliases)?row.scheduleAliases:[])].filter(personName);
const staffId=row=>text(row?.staffId)||text(row?.id);
const dateKey=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('Choose an exact work date.');return value;};
export const swapAdjacentDate=(date,offset)=>new Date(Date.parse(dateKey(date)+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
const monthOf=snapshot=>`${snapshot?.currentYear}-${String(snapshot?.currentMonth).padStart(2,'0')}`;

function identityIndex(snapshot,requesterAliases=[],requesterStaffId='',adjacentEmployees=[]){
 const people=new Map(),owners=new Map();
 for(const [i,row]of (Array.isArray(snapshot?.employees)?snapshot.employees:[]).entries()){
  const id=staffId(row),token=id?'id:'+id:'row:'+i,prior=people.get(token),names=new Set([...(prior?.names||[]),...aliases(row).map(key)]);
  const linkedNames=new Set([...(prior?.linkedNames||[]),...(id?aliases(row).map(key):[])]);
  people.set(token,{token,id,names,linkedNames,inactive:prior?.inactive||!activeStaffProfile(row)||row?.scheduleEligible===false});
 }
 const index=()=>{owners.clear();for(const person of people.values())for(const name of person.names){if(!owners.has(name))owners.set(name,new Set());owners.get(name).add(person.token);}};
 index();
 const ownNames=requesterAliases.filter(personName).map(key),id=text(requesterStaffId);
 if(ownNames.length){
  const found=new Set(ownNames.flatMap(name=>[...(owners.get(name)||[])]));
  const token=id?'id:'+id:found.size===1?[...found][0]:'requester';
  if([...found].some(other=>other!==token&&people.get(other)?.id))throw Error('The requester’s saved name is ambiguous. Ask HQ to review the staff links.');
  const prior=people.get(token);people.set(token,{token,id:id||prior?.id||'',names:new Set([...(prior?.names||[]),...ownNames]),linkedNames:prior?.linkedNames||new Set(),inactive:prior?.inactive||false});
  // A legacy name-only roster row may describe the identified requester.
  for(const other of found)if(other!==token&&!people.get(other)?.id){for(const name of people.get(other).names)people.get(token).names.add(name);people.get(token).inactive ||= people.get(other).inactive;people.delete(other);}
  index();
 }
 // An exact ID link may contribute old dated names, never account eligibility.
 for(const row of adjacentEmployees){const id=staffId(row),person=id&&people.get('id:'+id);if(person)for(const name of aliases(row))person.names.add(key(name));}
 index();
 const resolve=name=>{const normalized=key(name),found=owners.get(normalized);if(found?.size>1)return {ambiguous:true,names:new Set([normalized])};if(found?.size===1)return people.get([...found][0]);return {token:'name:'+normalized,id:'',names:new Set([normalized]),inactive:false};};
 return {resolve};
}
function dated(snapshot,date,daySnapshots,{optional=false}={}){
 const selected=daySnapshots?.[date]||(date.slice(0,7)===monthOf(snapshot)?daySnapshots?.[Number(date.slice(-2))]:null);
 if(selected){if(monthOf(selected)!==date.slice(0,7))throw Error('The dated saved schedule does not match the swap date. Refresh its month.');return selected;}
 if(date.slice(0,7)!==monthOf(snapshot)){if(optional)return null;throw Error('Load the adjacent saved schedule month before requesting this swap.');}
 return snapshot;
}
function shiftFor(snapshot,date,branch,id){
 const rules=(Array.isArray(snapshot?.branchConfig?.[branch])?snapshot.branchConfig[branch]:[]).filter(shift=>shift.id===id);
 const weekday=new Date(date+'T00:00:00Z').getUTCDay();
 if(rules.length!==1||rules[0].active===false||Array.isArray(rules[0].days)&&!rules[0].days.includes(weekday))throw Error('A requested shift is no longer active.');
 const rule=rules[0],minutes=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value||'')?Number(value.slice(0,2))*60+Number(value.slice(3)):null;
 const start=minutes(rule.startTime),end=minutes(rule.endTime);
 if(start===null||end===null)throw Error('A requested shift has incomplete saved hours. Ask HQ to review its rules.');
 const duration=end+(end<=start?1440:0)-start;
 if(duration<60||duration>18*60)throw Error('A requested shift needs saved hours between 1 and 18 hours. Ask HQ to review its rules.');
 const origin=Date.parse(date+'T00:00:00Z');return {...rule,interval:{start:origin+start*60000,end:origin+(end+(end<=start?1440:0))*60000}};
}
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
const needsFollowingDate=(date,...shifts)=>shifts.some(shift=>shift&&shift.interval.end>Date.parse(date+'T00:00:00Z')+86400000);
export function swapEvidenceDates(snapshot,request,{daySnapshots}={}){
 const date=dateKey(request?.workDate),selected=dated(snapshot,date,daySnapshots),branch=text(request.branch),targetBranch=text(request.targetBranch)||branch;
 const source=shiftFor(selected,date,branch,request.requesterShiftId),target=request.targetShiftId==='STANDBY'?null:shiftFor(selected,date,targetBranch,request.targetShiftId);
 return [swapAdjacentDate(date,-1),date,...(needsFollowingDate(date,source,target)?[swapAdjacentDate(date,1)]:[])];
}
function allAssignments(snapshot,date,index){
 const day=Number(date.slice(-2)),rows=[];
 for(const [branch,row]of Object.entries(snapshot?.currentSchedule?.[day]||{}))for(const [shiftId,name]of Object.entries(row?.scheduled||{}))if(personName(name))rows.push({branch,shiftId,name,identity:index.resolve(name)});
 return rows;
}
function unavailable(snapshot,date,identity,index){
 const matches=reference=>{const id=typeof reference==='object'?staffId(reference):'';if(id&&identity.id&&id===identity.id)return true;const name=typeof reference==='object'?reference.name||reference.staffName||reference.cashierName:reference;const other=index.resolve(name);return other.token===identity.token||identity.names.has(key(name))||other.ambiguous&&identity.names.has(key(name));};
 for(const row of Object.values(snapshot?.currentSchedule?.[Number(date.slice(-2))]||{}))for(const flag of Array.isArray(row?.unavailable)?row.unavailable:[])if(matches(flag))return true;
 const flags=snapshot?.unavailability?.[date];
 if(Array.isArray(flags))return flags.some(matches);
 return !!flags&&typeof flags==='object'&&Object.entries(flags).some(([name,flag])=>flag&&matches(typeof flag==='object'?{...flag,name:flag.name||name}:name));
}
function prepare({snapshot,workDate,requesterBranch,requesterShiftId,requesterAliases=[],requesterStaffId,daySnapshots}){
 const date=dateKey(workDate),selected=dated(snapshot,date,daySnapshots),day=Number(date.slice(-2)),row=selected?.currentSchedule?.[day]?.[requesterBranch],name=row?.scheduled?.[requesterShiftId];
 if(!personName(name))throw Error('The requester’s exact shift assignment changed. Ask staff to submit a new swap.');
 const neighbors=[-1,1].map(offset=>{const adjacent=swapAdjacentDate(date,offset);return {date:adjacent,offset,snapshot:dated(snapshot,adjacent,daySnapshots,{optional:offset===1})};});
 const index=identityIndex(selected,requesterAliases,requesterStaffId,neighbors.flatMap(row=>Array.isArray(row.snapshot?.employees)?row.snapshot.employees:[])),requester=index.resolve(name);
 if(requester.ambiguous||requester.inactive||requesterStaffId&&requester.id&&requester.id!==requesterStaffId||!requesterAliases.some(alias=>requester.names.has(key(alias))))throw Error('This assignment does not belong to your active staff account.');
 const assignments=allAssignments(selected,date,index),own=assignments.filter(item=>item.identity.token===requester.token||requester.names.has(key(item.name)));
 if(own.length!==1)throw Error('The requester has conflicting saved assignments. Ask HQ to review this date.');
 if(unavailable(selected,date,requester,index))throw Error('One of these staff members is marked unavailable on the swap date.');
 const requesterShift=shiftFor(selected,date,requesterBranch,requesterShiftId);
 return {date,selected,day,row,name,index,requester,requesterBranch,requesterStaffId,assignments,requesterShift,neighbors};
}
function assertCandidate(context,candidate){
 const {date,selected,day,index,requester,assignments,requesterShift,neighbors}=context;
 const branch=text(candidate.targetBranch),targetName=text(candidate.targetAssignedName),target=index.resolve(targetName),standby=candidate.targetShiftId==='STANDBY',targetRow=selected?.currentSchedule?.[day]?.[branch];
 if(!branch||!personName(targetName)||target.ambiguous||target.inactive||target.token===requester.token||requester.names.has(key(targetName)))throw Error('The swap needs two distinct active, unambiguous staff assignments.');
 if(branch!==context.requesterBranch&&(!context.requesterStaffId||requester.id!==context.requesterStaffId||!requester.linkedNames?.has(key(context.name))||!candidate.targetStaffId||target.id!==candidate.targetStaffId||!target.linkedNames?.has(key(targetName))))throw Error('Cross-branch swaps need both exact staff account links in the saved roster. Ask HQ to repair the roster.');
 if(candidate.targetStaffId&&target.id&&candidate.targetStaffId!==target.id)throw Error('The target staff account and saved assignment do not match.');
 if(unavailable(selected,date,target,index))throw Error('One of these staff members is marked unavailable on the swap date.');
 const targetAssignments=assignments.filter(item=>item.identity.token===target.token||target.names.has(key(item.name)));
 let targetShift=null;
 if(standby){
  if(!Array.isArray(targetRow?.rest)||targetRow.rest.filter(name=>text(name)===targetName).length!==1)throw Error('The target’s exact rest-day assignment changed.');
  if(targetAssignments.length)throw Error('The standby staff member already has a saved working shift.');
 }else{
  if(text(targetRow?.scheduled?.[candidate.targetShiftId])!==targetName)throw Error('The target’s exact shift assignment changed. Ask staff to submit a new swap.');
  if(targetAssignments.length!==1)throw Error('The target has conflicting saved assignments. Ask HQ to review this date.');
  targetShift=shiftFor(selected,date,branch,candidate.targetShiftId);
 }
 const following=needsFollowingDate(date,requesterShift,targetShift);
 for(const {date:adjacent,snapshot,offset}of neighbors){
  if(offset===1&&!following)continue;
  if(!snapshot)throw Error('Load the adjacent saved schedule month before requesting this overnight swap.');
  for(const assignment of allAssignments(snapshot,adjacent,index)){
   const isRequester=assignment.identity.token===requester.token||requester.names.has(key(assignment.name)),isTarget=assignment.identity.token===target.token||target.names.has(key(assignment.name));
   if(!isTarget&&!(isRequester&&targetShift))continue;
   const adjacentShift=shiftFor(snapshot,adjacent,assignment.branch,assignment.shiftId);
   if(overlap(adjacentShift.interval,isTarget?requesterShift.interval:targetShift.interval))throw Error('This swap overlaps another saved shift, including an overnight assignment.');
  }
 }
 return {target,targetShift,standby,targetRow};
}

export function swapCandidates(input={}){
 let context;try{context=prepare(input);}catch{return [];}
 const output=[];
 for(const [branch,row]of Object.entries(context.selected?.currentSchedule?.[context.day]||{})){
  const add=(name,shiftId)=>{if(!personName(name))return;const identity=context.index.resolve(name);if(branch!==input.requesterBranch&&!identity.id)return;const candidate={targetBranch:branch,targetAssignedName:text(name),targetName:text(name),...(identity.id?{targetStaffId:identity.id}:{}),targetShiftId:shiftId,targetShiftName:'Standby',kind:shiftId==='STANDBY'?'standby':'scheduled'};
   try{const checked=assertCandidate(context,candidate);if(checked.targetShift)candidate.targetShiftName=checked.targetShift.name||shiftId;output.push(candidate);}catch{/* A conflicting or unavailable account cannot be offered. */}};
  for(const [shiftId,name]of Object.entries(row?.scheduled||{}))add(name,shiftId);
  for(const name of Array.isArray(row?.rest)?row.rest:[])add(name,'STANDBY');
 }
 output.sort((a,b)=>a.targetBranch.localeCompare(b.targetBranch)||a.targetName.localeCompare(b.targetName)||a.targetShiftId.localeCompare(b.targetShiftId));
 const standby=new Map();
 for(const candidate of output.filter(row=>row.kind==='standby')){const identity=candidate.targetStaffId?'id:'+candidate.targetStaffId:'name:'+key(candidate.targetAssignedName),prior=standby.get(identity);if(!prior||candidate.targetBranch===input.requesterBranch&&prior.targetBranch!==input.requesterBranch)standby.set(identity,candidate);}
 return output.filter(candidate=>candidate.kind!=='standby'||standby.get(candidate.targetStaffId?'id:'+candidate.targetStaffId:'name:'+key(candidate.targetAssignedName))===candidate);
}

export function applyScheduleSwap(snapshot,request,{daySnapshots}={}){
 const date=dateKey(request?.workDate),branch=text(request.branch),targetBranch=text(request.targetBranch)||branch,requester=text(request.requesterAssignedName||request.requesterName),target=text(request.targetAssignedName||request.targetName);
 if(monthOf(snapshot)!==date.slice(0,7))throw Error('The swap is outside the loaded schedule month.');
 if(!branch||!request.requesterShiftId||!request.targetShiftId||request.requesterShiftId==='STANDBY'||branch===targetBranch&&request.requesterShiftId===request.targetShiftId)throw Error('The swap request has invalid branch or shift details.');
 const selected=dated(snapshot,date,daySnapshots);
 if(text(selected.currentSchedule?.[Number(date.slice(-2))]?.[branch]?.scheduled?.[request.requesterShiftId])!==requester)throw Error('The requester’s exact shift assignment changed. Ask staff to submit a new swap.');
 const context=prepare({snapshot,workDate:date,requesterBranch:branch,requesterShiftId:request.requesterShiftId,requesterAliases:[requester],requesterStaffId:request.requesterStaffId,daySnapshots});
 if(context.name!==requester)throw Error('The requester’s exact shift assignment changed. Ask staff to submit a new swap.');
 const checked=assertCandidate(context,{...request,targetBranch,targetAssignedName:target}),output=copy(snapshot),day=context.day;
 // The one-day revision must retain the shift rules inspected for this date.
 output.branchConfig=copy(context.selected.branchConfig);
 output.currentSchedule[day]=copy(context.selected.currentSchedule[day]);
 const source=output.currentSchedule[day][branch],destination=output.currentSchedule[day][targetBranch];source.swaps||={};
 if(checked.standby){destination.rest=destination.rest.filter(name=>text(name)!==target);source.rest||=[];if(!source.rest.some(name=>key(name)===key(requester)))source.rest.push(requester);}
 else{destination.scheduled[request.targetShiftId]=requester;destination.swaps||={};destination.swaps[request.targetShiftId]=target;}
 source.scheduled[request.requesterShiftId]=target;source.swaps[request.requesterShiftId]=requester;
 return output;
}
