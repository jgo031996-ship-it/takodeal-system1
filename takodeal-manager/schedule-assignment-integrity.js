import {activeLeaveDates} from './leave-model.js';
import {createStaffHistoryResolver} from './staff-lifecycle-model.js';
import {toScheduleEmployee,scheduleIdentityDirectory} from './schedule-staff-directory.js';
import {shiftAmendmentRuleTimes,shiftAmendmentFingerprint} from './shift-amendments.js';
import {monthKey,scheduleDateKey,resolveScheduleForDate} from './schedule-history.js';

const oneDay=86400000;
const named=name=>typeof name==='string'&&name.trim()&&!['UNFILLED','N/A'].includes(name);
const dateNear=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*oneDay).toISOString().slice(0,10);
const nameKey=name=>String(name||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
const slotRule=(snapshot,branch,slot)=>snapshot?.branchConfig?.[branch]?.find(rule=>rule.id===slot);
const slotKey=(date,branch,slot)=>JSON.stringify([date,branch,slot]);
const docData=snap=>snap?.exists?.()?snap.data():null;

function interval(date,rule) {
  const {startTime,endTime}=shiftAmendmentRuleTimes(rule);
  if(!startTime||!endTime)return null;
  const start=Date.parse(date+'T'+startTime+':00+08:00');
  let end=Date.parse(date+'T'+endTime+':00+08:00');
  if(end<=start)end+=oneDay;
  return {start,end};
}

function assignments(snapshot,onlyDate) {
  if(!snapshot)return [];
  const rows=[],month=monthKey(snapshot);
  for(const [day,branches] of Object.entries(snapshot.currentSchedule||{})){
    const date=month+'-'+String(day).padStart(2,'0');
    if(onlyDate&&date!==onlyDate)continue;
    for(const [branch,row] of Object.entries(branches||{}))for(const [slot,name] of Object.entries(row?.scheduled||{})){
      if(named(name))rows.push({date,branch,slot,name,key:slotKey(date,branch,slot),time:interval(date,slotRule(snapshot,branch,slot))});
    }
  }
  return rows;
}

function conflict(changed,other) {
  if(changed.key===other.key)return false;
  if(changed.date===other.date)return true;
  if(!changed.time||!other.time)return Math.abs(Date.parse(changed.date)-Date.parse(other.date))<=oneDay;
  return changed.time.start<other.time.end&&other.time.start<changed.time.end;
}
function assertClear(row,others,resolve,except) {
  const person=resolve(row.name);
  if(!person.active||!person.staffId)throw Error(row.name+' needs an active, unambiguous employee record before assignment.');
  for(const other of others){
    if(other.key===except||!conflict(row,other))continue;
    const identity=resolve(other.name);
    if(identity.staffId===person.staffId||nameKey(other.name)===nameKey(row.name))
      throw Error(row.name+' already has '+other.branch+' · '+other.date+' · '+other.slot+'. Review the two shifts before assigning.');
  }
  return person;
}

export function assertLocalScheduleChoice(snapshot,directory,{date,branch,slot,name,source}) {
  return assertClear({date,branch,slot,name,key:slotKey(date,branch,slot),time:interval(date,slotRule(snapshot,branch,slot))},
    assignments(snapshot),createStaffHistoryResolver(directory),source&&slotKey(date,source.branch,source.shiftId));
}

export function changedScheduleAssignments(baseline,snapshot,from) {
  const old=new Map(assignments(baseline).map(row=>[row.key,row]));
  return assignments(snapshot).filter(row=>{
    if(row.date<from)return false;
    const before=old.get(row.key);
    return !before||before.name!==row.name||before.time?.start!==row.time?.start||before.time?.end!==row.time?.end;
  });
}

// The writer supplies one transaction for the leave query, staff lookups, adjacent
// month reads, history append and shared schedule update.
export async function validateScheduleTransaction(api,tx,{snapshot,baseline,from,current,expectedHead,readApprovedLeaves,readSettings,today}) {
  if(current&&monthKey(current)===monthKey(snapshot)&&expectedHead!==undefined&&shiftAmendmentFingerprint(current)!==expectedHead)
    throw Error('This schedule changed in another session. Reload its month before saving.');
  const changed=changedScheduleAssignments(baseline,snapshot,from);
  if(!changed.length)return;
  const directory=scheduleIdentityDirectory(api.scheduleDirectoryProfiles||snapshot.employees,snapshot.employees);
  const resolve=createStaffHistoryResolver(directory),external=new Map(),others=assignments(snapshot);
  const people=new Map();
  for(const row of changed){
    const account=assertClear(row,others,resolve);
    people.set(account.staffId,account);
    for(const day of [dateNear(row.date,-1),dateNear(row.date,1)]){
      if(day.slice(0,7)!==monthKey(snapshot))external.set(day,null);
    }
  }
  for(const day of external.keys()){
    const month=day.slice(0,7),key=month.replace('-','_');
    const [index,durable]=await Promise.all([readSettings('schedule_month_'+key),readSettings('schedule_shift_amendments_'+key)]);
    const revisions=await Promise.all((index?.revisionIds||[]).map(async id=>{
      const revision=await readSettings('schedule_revision_'+id);
      if(!revision||revision.month!==month||!revision.snapshot)throw Error('Reload the adjacent schedule month to confirm its hours.');
      return revision;
    }));
    const history={month,revisions,shiftAmendments:durable?.shiftAmendments||index?.shiftAmendments||[]};
    const dated=resolveScheduleForDate(history,day);
    const live=current&&monthKey(current)===month?current:null;
    // Include unarchived current-day edits as well as the effective saved day.
    const latest=revisions.find(r=>r.revisionId===live?.scheduleRevisionId);
    const legacy=live&&(!latest||shiftAmendmentFingerprint(live.currentSchedule)!==shiftAmendmentFingerprint(latest.snapshot.currentSchedule)
      ||shiftAmendmentFingerprint(live.branchConfig)!==shiftAmendmentFingerprint(latest.snapshot.branchConfig));
    others.push(...assignments(legacy&&day>=today?live:dated||live,day));
  }
  for(const row of changed)assertClear(row,others,resolve);
  const profiles=await Promise.all([...people.keys()].map(async id=>{
    const record=docData(await tx.get(api.doc(api.db,'cashiers',id)));
    const person=record&&toScheduleEmployee(record,id);
    if(!person?.scheduleEligible||person.name!==people.get(id).profile.name)throw Error((people.get(id).name||id)+' is inactive or changed in HR. Reopen that shift before saving.');
    return person;
  }));
  const changedById=new Map(profiles.map(p=>[p.staffId,changed.filter(row=>resolve(row.name).staffId===p.staffId)]));
  const leaves=await readApprovedLeaves();
  for(const request of leaves){
    if(request.type!=='Leave'||request.status!=='Approved')continue;
    const person=request.staffId?{staffId:request.staffId}:resolve(request.staffName||request.name);
    const rows=changedById.get(person.staffId);
    if(!rows?.length){
      if(!request.staffId&&person.status==='identity-review'&&changed.some(row=>nameKey(row.name)===nameKey(request.staffName||request.name)))
        throw Error('An approved leave has an ambiguous staff name. Review its identity before saving.');
      continue;
    }
    if(!request.activeLeaveDates&&request.endDate<from)continue;
    const dates=new Set(activeLeaveDates(request));
    for(const row of rows)if(dates.has(row.date))throw Error(row.name+' has approved leave on '+row.date+'. Review this shift before saving.');
  }
}
