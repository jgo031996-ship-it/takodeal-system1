// Display saved attendance evidence only. This preview never assigns a shift.
const minute=60000;
const text=value=>String(value??'');
const escape=value=>text(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const instant=value=>{if(value===null||value===undefined||value==='')return null;const date=value?.toDate?value.toDate():value?.seconds!==undefined?new Date(value.seconds*1000):new Date(value);return Number.isFinite(+date)?date:null;};
const dayKey=date=>{const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
const dayLabel=date=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'}).format(date);
const timeLabel=date=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit',hour12:true}).format(date);

export function plannedAttendancePreview(snapshot={}, {staffName=snapshot.staffName,branch=snapshot.branch,at=new Date()}={}) {
 const start=instant(snapshot.expectedStartAt),finish=instant(snapshot.expectedEndAt),actual=instant(at);
 const hasTimes=Boolean(start&&finish&&finish>start&&finish-start>=60*minute&&finish-start<=18*60*minute);
 const verified=hasTimes&&snapshot.needsScheduleReview!==true&&snapshot.wasScheduled===true;
 const workDate=start?dayKey(start):actual?dayKey(actual):'';
 return {staffName:text(staffName),branch:text(branch),shiftName:text(snapshot.shiftName),workDate,
  verified,hasTimes,nextDay:hasTimes&&dayKey(start)!==dayKey(finish),
  start:hasTimes?`${dayLabel(start)}, ${timeLabel(start)}`:'Needs schedule review',
  finish:hasTimes?`${dayLabel(finish)}, ${timeLabel(finish)}`:'Needs schedule review',
  notice:verified?'These are your saved assigned hours. Time In records your actual arrival; it does not change the schedule.':'HQ could not confirm one assigned shift for this punch. Time In can still record your actual arrival for management review; no lateness is inferred from an unverified assignment.'};
}

// Ignore elapsed time and late-minute calculation; compare the schedule evidence
// the employee saw with the fresh evidence read immediately before the punch.
export function attendanceScheduleIdentity(snapshot={}) {
 return JSON.stringify(['branch','staffName','shiftId','shiftName','shiftType','expectedStartAt','expectedEndAt','scheduleRevisionId','wasScheduled','needsScheduleReview','scheduleReviewReason'].map(key=>snapshot[key]??null));
}

export function assertAttendanceScheduleUnchanged(before,after) {
 if(attendanceScheduleIdentity(before)!==attendanceScheduleIdentity(after))throw Error('HQ updated the assigned schedule during verification. No Time In was saved. Tap Time In again to review the latest hours. Your selected late-proof draft is kept.');
 return after;
}

// Work assignments take priority over a leftover home-branch standby record.
// Conflicting work assignments are exposed rather than selecting one silently.
export function staffScheduleDay(dayData={},branchConfig={},aliases=[]) {
 const key=value=>text(value).trim().replace(/\s+/g,' ').toLowerCase(),names=new Set(aliases.filter(Boolean).map(key));
 const assignments=[],unavailable=[],standby=[];
 for(const [branch,record]of Object.entries(dayData||{})) {
  for(const [shiftId,name]of Object.entries(record?.scheduled||{}))if(names.has(key(name))){
   const rules=(Array.isArray(branchConfig[branch])?branchConfig[branch]:[]).filter(rule=>rule.id===shiftId);
   assignments.push({branch,shiftId,shift:rules.length===1?rules[0]:null});
  }
  for(const row of record?.unavailable||[])if(names.has(key(row?.name)))unavailable.push({branch,status:text(row.status)});
  if((record?.rest||[]).some(name=>names.has(key(name))))standby.push({branch});
 }
 return {assignments,unavailable,standby,conflict:assignments.length>1||assignments.some(row=>!row.shift)||assignments.some(row=>unavailable.some(leave=>leave.branch===row.branch))};
}

export function renderStaffScheduleConflict(day) {
 return `<div style="padding:8px;border:1px solid #efd09b;border-radius:8px;background:#fff8e8;color:#7d4e13"><strong>Assigned hours need HQ review</strong><div>${day.assignments.map(row=>`${escape(row.branch)} · ${escape(row.shift?.name||row.shiftId)}${row.shift?.startTime&&row.shift?.endTime?` · ${escape(row.shift.startTime)}–${escape(row.shift.endTime)}`:' · missing shift rule'}`).join('<br>')}</div><div>More than one saved instruction or an incomplete shift was found. Ask management to confirm the correct hours; this screen does not choose a shift.</div></div>`;
}

export function renderAttendanceSchedulePreview(snapshot,options={}) {
 const planned=plannedAttendancePreview(snapshot,options);
 return `<div class="attendance-schedule-preview" style="text-align:left;font-size:14px;line-height:1.55"><p><strong>${escape(planned.staffName)}</strong><br>${escape(planned.branch)} · Philippine time</p><div style="padding:14px;border:1px solid #cbded2;border-radius:12px;background:#f4f8f1"><strong>${planned.verified?'Saved assigned shift':'Schedule review needed'}</strong><div>${escape(planned.shiftName||'No confirmed assignment')}</div><div>Work date: ${escape(planned.workDate||'Unconfirmed')}</div>${planned.hasTimes?`${planned.verified?'':'<div><strong>Unverified reference hours</strong></div>'}<div>Start: <strong>${escape(planned.start)}</strong></div><div>Finish: <strong>${escape(planned.finish)}</strong>${planned.nextDay?' · next day':''}</div>`:''}</div><p>${escape(planned.notice)}</p></div>`;
}
