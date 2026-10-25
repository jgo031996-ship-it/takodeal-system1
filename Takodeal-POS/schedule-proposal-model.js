// Assignment proposals only. HQ shift rules, leave, punches and payroll are not edited here.
import {scheduleDateKey,monthKey} from './schedule-history.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const key=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,120}$/.test(value);
const own=(value,name)=>Object.prototype.hasOwnProperty.call(value||{},name);
const alias=value=>String(value||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const empty=value=>value===undefined||value===null||value===''||value==='N/A'||value==='UNFILLED';
const status=value=>typeof value==='string'?value:String(value?.status||'Leave');
const dayOff=value=>!value?.leaveRequestId&&/^day\s*off$/i.test(status(value).trim());
const unavailable=(name,value)=>({name,status:status(value),...(object(value)?clone(value):{})});
export const scheduleProposalCanonical=value=>JSON.stringify(value,(_key,item)=>object(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function exact(value,fields,message){if(!object(value)||Object.keys(value).sort().join('|')!==[...fields].sort().join('|'))throw Error(message);}
function range(branch,from,to,today){
 if(typeof branch!=='string'||!branch.trim()||branch.length>120)throw Error('Choose the assigned branch.');
 scheduleDateKey(from);scheduleDateKey(to);scheduleDateKey(today);
 const month=monthKey(from.slice(0,7));if(from<today||from>to||to.slice(0,7)!==month)throw Error('Choose today or future dates within one schedule month.');
 const days=[];for(let d=new Date(from+'T12:00:00Z');d.toISOString().slice(0,10)<=to;d.setUTCDate(d.getUTCDate()+1)){days.push(d.toISOString().slice(0,10));if(days.length>31)throw Error('Choose no more than 31 days.');}return {branch,month,from,to,dates:days};
}
function directory(staff,view,branch){
 if(!Array.isArray(staff)||staff.length>2000)throw Error('Reload the saved branch staff directory.');
 const people=new Map(),aliases=new Map();
 const add=(name,id)=>{const value=alias(name);if(!value)return;let ids=aliases.get(value);if(!ids)aliases.set(value,ids=new Set());ids.add(id);};
 for(const row of staff){const id=row?.staffId||row?.id;if(!key(id))throw Error('A saved staff reference needs HQ review.');if(people.has(id))throw Error('The staff directory contains a duplicate account.');
  const active=row.active!==false&&row.blocked!==true&&row.archived!==true&&!/^(revoked|resigned|terminated|inactive|blocked|disabled|deleted|archived)$/i.test(String(row.status||'').trim());
  const name=String(row.name||row.cashierName||'').trim(),scheduleName=String(row.scheduleName||row.scheduleNickname||name).trim();
  people.set(id,{staffId:id,name,scheduleName,branch:row.branch,active:active&&Boolean(name)&&row.branch===branch});
  if(row.branch===branch){add(name,id);add(scheduleName,id);}
 }
 // Include roster aliases even when their account was not among point-read profiles.
 // This detects ambiguous legacy names without requiring a global staff query.
 const snapshots=[view.editorSnapshot,...Object.values(view.daySnapshots||{})];
 for(const snapshot of snapshots)for(const row of snapshot?.employees||[]){if(row.branch!==branch)continue;const id=row.staffId||row.id;if(key(id)){add(row.name,id);add(row.cashierName,id);add(row.scheduleNickname,id);add(row.scheduleName,id);}}
 const resolve=(name,id)=>{
  if(id){if(!key(id)||!people.has(id))return null;const person=people.get(id);if(person.branch!==branch)return null;const ids=aliases.get(alias(name));if(name&&ids?.size&&(!ids.has(id)||ids.size!==1))throw Error('A saved roster name matches more than one staff account. Ask HQ to repair its staff links.');return person;}
  const ids=aliases.get(alias(name));if(!ids)return null;if(ids.size!==1)throw Error('A saved roster name matches more than one staff account. Ask HQ to repair its staff links.');return people.get([...ids][0])||null;
 };
 return {people,resolve};
}
function dated(view,date,branch){const day=String(Number(date.slice(-2))),snapshot=view?.daySnapshots?.[day];
 if(!view?.hasSavedSchedule||!key(view.expectedRevisionId)||!snapshot||!key(view.dayRevisions?.[day])||(view.unverifiedDays||[]).includes(Number(day))||!Array.isArray(snapshot.branchConfig?.[branch])||!object(snapshot.currentSchedule?.[day]?.[branch]))throw Error('HQ must publish a verified roster for every selected date before it can be changed.');
 return {day,snapshot,row:snapshot.currentSchedule[day][branch]};
}
export function scheduleProposalFingerprint({monthView,branch,from,to,today=from}){
 const selected=range(branch,from,to,today);if(monthView?.month!==selected.month)throw Error('Reload the selected saved month.');
 return scheduleProposalCanonical({version:1,branch,month:selected.month,from,to,days:selected.dates.map(date=>{const {snapshot,row}=dated(monthView,date,branch);return {date,revisionId:monthView.dayRevisions[Number(date.slice(-2))],rules:snapshot.branchConfig[branch],roster:row,flags:snapshot.unavailability?.[date]||{},holiday:snapshot.holidays?.[date]||null,employees:(snapshot.employees||[]).filter(p=>p.branch===branch)};})});
}
export function scheduleProposalContext({monthView,staff,branch,from,to,today=from}){
 const selected=range(branch,from,to,today),dir=directory(staff,monthView,branch);
 const fingerprint=scheduleProposalFingerprint({monthView,branch,from,to,today});let rulesKey;
 const days=selected.dates.map(date=>{
  const {day,snapshot,row}=dated(monthView,date,branch),rules=snapshot.branchConfig[branch];
  const currentRules=scheduleProposalCanonical(rules);if(rulesKey!==undefined&&rulesKey!==currentRules)throw Error('HQ shift rules change within these dates. Split the proposal into separate date ranges.');rulesKey=currentRules;
  const weekDay=new Date(date+'T12:00:00Z').getUTCDay(),seenShifts=new Set();
  const shifts=rules.filter(shift=>{if(!key(shift?.id)||seenShifts.has(shift.id))throw Error('HQ must repair duplicate or missing shift IDs.');seenShifts.add(shift.id);return shift.active!==false&&(!Array.isArray(shift.days)||shift.days.includes(weekDay));}).map(shift=>({shiftId:shift.id,name:String(shift.name||'Shift'),startTime:String(shift.startTime||''),endTime:String(shift.endTime||'')}));
  const protectedRows=[],protectedIds=new Set(),required=new Set(),sourceIds=new Set(),unresolvedRest=[],unresolvedOff=[];
  const protect=(name,value)=>{const person=dir.resolve(name,value?.staffId);if(person)protectedIds.add(person.staffId);if(!protectedRows.some(row=>alias(row.name)===alias(name)))protectedRows.push({...unavailable(name,value),...(person?{staffId:person.staffId}:{})});};
  for(const entry of row.unavailable||[])if(!dayOff(entry))protect(entry.name,entry);
  for(const [name,value] of Object.entries(snapshot.unavailability?.[date]||{})){const person=dir.resolve(name,value?.staffId);if(person&&!dayOff(value))protect(name,value);}
  const take=(name,id,strict)=>{const person=dir.resolve(name,id);if(!person?.active){if(strict)throw Error('A saved assigned staff account is missing or inactive. Ask HQ to repair this roster before proposing changes.');return null;}if(sourceIds.has(person.staffId))throw Error('The saved roster repeats a staff member. Ask HQ to repair it first.');sourceIds.add(person.staffId);required.add(person.staffId);return person;};
  const scheduled=shifts.map(shift=>{const name=row.scheduled?.[shift.shiftId],person=empty(name)?null:take(name,null,true);return {shiftId:shift.shiftId,staffId:person?.staffId||null};});
  for(const [shiftId,name] of Object.entries(row.scheduled||{}))if(!shifts.some(s=>s.shiftId===shiftId)&&!empty(name))throw Error('A saved assignment uses an inactive HQ shift. Ask HQ to review this date.');
  const standbyStaffIds=[];for(const name of row.rest||[]){const person=take(name,null,false);if(person)standbyStaffIds.push(person.staffId);else unresolvedRest.push(name);}
  const offStaffIds=[];for(const entry of row.unavailable||[])if(dayOff(entry)){const person=take(entry.name,entry.staffId,false);if(person)offStaffIds.push(person.staffId);else unresolvedOff.push(clone(entry));}
  // A Day Off marker may exist before the monthly roster row was regenerated.
  for(const [name,value] of Object.entries(snapshot.unavailability?.[date]||{}))if(dayOff(value)){const person=dir.resolve(name,value?.staffId);if(person?.active&&!sourceIds.has(person.staffId)){sourceIds.add(person.staffId);required.add(person.staffId);offStaffIds.push(person.staffId);}}
  for(const id of protectedIds)if(sourceIds.has(id))throw Error('Approved leave conflicts with an assignment. Ask HQ to review this date.');
  return {date,shifts,scheduled,standbyStaffIds,offStaffIds,protected:protectedRows,requiredStaffIds:[...required].sort(),protectedStaffIds:[...protectedIds].sort(),unresolvedRest,unresolvedOff};
 });
 return {...selected,baseRevisionId:monthView.expectedRevisionId,baseBranchFingerprint:fingerprint,staff:[...dir.people.values()].filter(p=>p.active).sort((a,b)=>a.name.localeCompare(b.name)),days};
}
export function normalizeScheduleProposal(input,{monthView,staff,today}={}){
 exact(input,['version','id','branch','month','from','to','reason','baseRevisionId','baseBranchFingerprint','days'],'Check the schedule proposal fields.');
 if(input.version!==1||typeof input.id!=='string'||!/^[A-Za-z0-9_-]{1,85}$/.test(input.id)||typeof input.reason!=='string'||input.reason.trim().length<3||input.reason.length>1500||!Array.isArray(input.days))throw Error('Add a reason of at least 3 characters and valid proposal details.');
 const context=scheduleProposalContext({monthView,staff,branch:input.branch,from:input.from,to:input.to,today:today||input.from});
 if(input.month!==context.month||input.baseRevisionId!==context.baseRevisionId||input.baseBranchFingerprint!==context.baseBranchFingerprint)throw Error('The saved schedule changed. Reload it and review your proposal again.');
 if(input.days.length!==context.days.length)throw Error('Include every date in the proposal range exactly once.');
 const people=new Map(context.staff.map(row=>[row.staffId,row]));
 const days=context.days.map((source,index)=>{
  const row=input.days[index];exact(row,['date','scheduled','standbyStaffIds','offStaffIds'],'Check each proposed day.');
  if(row.date!==source.date||!Array.isArray(row.scheduled)||row.scheduled.length!==source.shifts.length||!Array.isArray(row.standbyStaffIds)||!Array.isArray(row.offStaffIds))throw Error('Choose existing HQ shift slots for every selected date.');
  const seen=new Set(),add=id=>{if(!key(id)||!people.has(id)||source.protectedStaffIds.includes(id))throw Error('Choose an active staff account from this branch without protected leave.');if(seen.has(id))throw Error('A staff member can appear only once on each date.');seen.add(id);return id;};
  const scheduled=source.shifts.map((shift,i)=>{const slot=row.scheduled[i];exact(slot,['shiftId','staffId'],'Use the existing HQ shift slots.');if(slot.shiftId!==shift.shiftId)throw Error('HQ shift slots and times cannot be changed in a proposal.');return {shiftId:slot.shiftId,staffId:slot.staffId===null?null:add(slot.staffId)};});
  const standbyStaffIds=row.standbyStaffIds.map(add).sort(),offStaffIds=row.offStaffIds.map(add).sort();
  if(source.requiredStaffIds.some(id=>!seen.has(id)))throw Error('Keep every saved staff member assigned, on standby or on Day Off.');
  return {date:row.date,scheduled,standbyStaffIds,offStaffIds};
 });
 return {version:1,id:input.id,branch:context.branch,month:context.month,from:context.from,to:context.to,reason:input.reason.trim(),baseRevisionId:context.baseRevisionId,baseBranchFingerprint:context.baseBranchFingerprint,days};
}
export function buildApprovedScheduleProposalSnapshot(monthView,input,staff){
 const proposal=normalizeScheduleProposal(input,{monthView,staff,today:input.from}),context=scheduleProposalContext({monthView,staff,branch:proposal.branch,from:proposal.from,to:proposal.to,today:proposal.from});
 const output=clone(monthView.editorSnapshot),people=new Map(context.staff.map(row=>[row.staffId,row]));
 output.currentSchedule||={};output.unavailability||={};output.holidays||={};
 output.employees||=[];
 const referenced=new Set(proposal.days.flatMap(day=>[...day.scheduled.map(row=>row.staffId).filter(Boolean),...day.standbyStaffIds,...day.offStaffIds]));
 for(const id of referenced){const person=people.get(id);if(!output.employees.some(row=>row.branch===proposal.branch&&(row.staffId===id||alias(row.name)===alias(person.scheduleName)||alias(row.name)===alias(person.name))))output.employees.push({staffId:id,name:person.scheduleName,branch:proposal.branch});}
 const allBranches=Object.keys(output.branchConfig||{}).sort();let fullRules;
 for(let i=0;i<proposal.days.length;i++){
  const change=proposal.days[i],source=context.days[i],{day,snapshot,row}=dated(monthView,change.date,proposal.branch);
  // A scoped Cashier projection cannot be used to save an Owner revision.
  if(allBranches.some(branch=>!own(snapshot.branchConfig,branch)))throw Error('Approval needs a fresh full HQ schedule view.');
  const rules=scheduleProposalCanonical(snapshot.branchConfig);if(fullRules!==undefined&&fullRules!==rules)throw Error('HQ rules for another branch change within these dates. Split the proposal date range.');fullRules=rules;output.branchConfig=clone(snapshot.branchConfig);
  output.currentSchedule[day]=clone(snapshot.currentSchedule[day]||{});
  if(snapshot.unavailability?.[change.date])output.unavailability[change.date]=clone(snapshot.unavailability[change.date]);else delete output.unavailability[change.date];
  if(own(snapshot.holidays,change.date))output.holidays[change.date]=clone(snapshot.holidays[change.date]);else delete output.holidays[change.date];
  const next=clone(row);next.scheduled||={};next.swaps||={};
  for(const slot of change.scheduled){const before=row.scheduled?.[slot.shiftId],after=slot.staffId?people.get(slot.staffId).scheduleName:'UNFILLED';next.scheduled[slot.shiftId]=after;if(before!==after)delete next.swaps[slot.shiftId];}
  next.rest=[...change.standbyStaffIds.map(id=>people.get(id).scheduleName),...source.unresolvedRest];
  next.unavailable=[...(row.unavailable||[]).filter(entry=>!dayOff(entry)),...source.unresolvedOff,...change.offStaffIds.map(id=>({name:people.get(id).scheduleName,status:'Day Off',staffId:id}))];
  const flags=output.unavailability[change.date]||{};const dir=directory(staff,monthView,proposal.branch);
  for(const [name,value] of Object.entries(flags)){const person=dir.resolve(name,value?.staffId);if(person?.active&&dayOff(value))delete flags[name];}
  for(const id of change.offStaffIds){const person=people.get(id);if(own(flags,person.scheduleName)&&!dayOff(flags[person.scheduleName]))throw Error('A saved leave marker needs HQ review.');flags[person.scheduleName]='Day Off';}
  if(Object.keys(flags).length)output.unavailability[change.date]=flags;else delete output.unavailability[change.date];
  output.currentSchedule[day][proposal.branch]=next;
 }
 return output;
}
