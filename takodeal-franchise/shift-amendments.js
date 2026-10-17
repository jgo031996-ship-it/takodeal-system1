// Immutable shift-time corrections. No attendance or financial record writes.
const clone=value=>JSON.parse(JSON.stringify(value));
export function shiftAmendmentFingerprint(value){
 const canonical=item=>item instanceof Date?item.toISOString():Array.isArray(item)?item.map(canonical):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,canonical(item[key])])):item;
 return JSON.stringify(canonical(value));
}
function dateKey(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Choose valid correction work dates.');
 const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));
 if(year<2000||year>2199||date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||date.getUTCDate()!==day)throw Error('Choose valid correction work dates.');return value;
}
export function shiftAmendmentTime(value){
 const match=String(value||'').trim().toLowerCase().replace(/\s/g,'').match(/^(\d{1,2})(?::(\d{2}))?(am|pm|nn)?$/);if(!match)return null;
 let hour=Number(match[1]),minute=Number(match[2]||0);if(minute>59||hour>(match[3]?12:23)||match[3]&&hour<1)return null;if(match[3]){hour%=12;if(match[3]!=='am')hour+=12;}return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
}
export function shiftAmendmentRuleTimes(shift){
 const label=String(shift?.name||'').match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|nn))/i);
 return {startTime:shiftAmendmentTime(shift?.startTime)??shiftAmendmentTime(label?.[1]),endTime:shiftAmendmentTime(shift?.endTime)??shiftAmendmentTime(label?.[2])};
}
export function normalizeShiftAmendment(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Reopen the shift correction form.');
 const id=String(input.id||''),branch=String(input.branch||'').trim(),sourceRevisionId=String(input.sourceRevisionId||''),reason=String(input.reason||'').trim();
 if(!/^[A-Za-z0-9_-]{1,72}$/.test(id)||!branch||branch.length>200||['all','hq main office'].includes(branch.toLowerCase())||!sourceRevisionId||sourceRevisionId.length>100||sourceRevisionId.includes('/'))throw Error('Choose a saved branch and source schedule version.');
 const effectiveFrom=dateKey(input.effectiveFrom),month=effectiveFrom.slice(0,7),end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate(),effectiveTo=dateKey(input.effectiveTo||month+'-'+String(end).padStart(2,'0'));
 if(effectiveTo.slice(0,7)!==month||effectiveFrom>effectiveTo)throw Error('Correction dates must belong to one schedule month.');
 if(reason.length<5||reason.length>2000)throw Error('Describe why these recorded shift times need correction.');
 if(input.reconcileSavedAssignments!==undefined&&typeof input.reconcileSavedAssignments!=='boolean')throw Error('Confirm the saved-assignment review option again.');
 if(!Array.isArray(input.changes)||!input.changes.length||input.changes.length>40)throw Error('Select at least one shift time to correct.');const ids=new Set();
 const changes=input.changes.map(row=>{const shiftId=String(row.shiftId||'');if(!shiftId||shiftId.length>200||shiftId.includes('/')||ids.has(shiftId))throw Error('Each corrected shift needs one unique saved shift ID.');ids.add(shiftId);const result={shiftId};for(const field of ['beforeStart','beforeEnd','startTime','endTime']){if(!/^\d{2}:\d{2}$/.test(String(row[field]||''))||!shiftAmendmentTime(row[field]))throw Error('Use valid Time In and Time Out values for every selected shift.');result[field]=row[field];}for(const [a,b]of [['beforeStart','beforeEnd'],['startTime','endTime']]){const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),duration=(minutes(result[b])-minutes(result[a])+1440)%1440;if(duration<60||duration>1080)throw Error('Check AM/PM: each shift must last between 1 and 18 hours.');}return result;});
 if(changes.every(row=>row.beforeStart===row.startTime&&row.beforeEnd===row.endTime))throw Error('Change at least one Time In or Time Out before saving.');
 return {id,branch,month,effectiveFrom,effectiveTo,sourceRevisionId,reason,reconcileSavedAssignments:input.reconcileSavedAssignments===true,changes};
}
export function amendmentsForDate(schedule,date){
 date=dateKey(date);const month=date.slice(0,7),archive=schedule?.historyMonths?.[month]||(schedule?.month===month?schedule:null),rows=archive?.shiftAmendments||[];
 if(!Array.isArray(rows))throw Error('Saved shift corrections need an HQ review.');
 const ids=new Set();return rows.map(row=>{const normalized=normalizeShiftAmendment(row);if(normalized.month!==month||ids.has(normalized.id))throw Error('Saved shift correction history is incomplete.');ids.add(normalized.id);return {...clone(row),...normalized};}).filter(row=>row.effectiveFrom<=date&&row.effectiveTo>=date).sort((a,b)=>(Number(a.sequence)||0)-(Number(b.sequence)||0)||String(a.recordedAt||'').localeCompare(String(b.recordedAt||''))||a.id.localeCompare(b.id));
}
export function applyShiftAmendments(snapshot,amendments,date){
 date=dateKey(date);const result=clone(snapshot),applied=[];
 for(const amendment of amendmentsForDate({month:date.slice(0,7),shiftAmendments:amendments||[]},date)){
  const revision=result.scheduleRevisionId||result.revisionId||'',source=amendment.sourceDates?.[date],eligible=source?revision===source||revision===amendment.canonicalRevisionId:(amendment.sourceRevisionIds||[amendment.sourceRevisionId]).includes(revision)||revision===amendment.canonicalRevisionId;
  if(!eligible)continue;const shifts=result.branchConfig?.[amendment.branch];if(!Array.isArray(shifts))continue;const changes=[];
  for(const change of amendment.changes){const matches=shifts.filter(shift=>shift.id===change.shiftId);if(matches.length!==1)continue;const shift=matches[0],times=shiftAmendmentRuleTimes(shift),before=times.startTime===change.beforeStart&&times.endTime===change.beforeEnd,after=times.startTime===change.startTime&&times.endTime===change.endTime;if(!before&&!after)continue;if(before){shift.startTime=change.startTime;shift.endTime=change.endTime;}changes.push({...change,alreadyApplied:!before&&after});}
  if(changes.length)applied.push({...amendment,changes});
 }
 delete result.scheduleAmendments;return applied.length?{...result,scheduleAmendments:applied}:result;
}
