import {monthKey} from './schedule-history.js';

const copy=value=>structuredClone(value);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);

// A proposal only. Never invent a work date for an extra legacy row, and never
// silently discard conflicting padded keys such as both "1" and "01".
export function planScheduleCalendar(snapshot){
 const month=monthKey(snapshot),count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate();
 if(!plain(snapshot.currentSchedule))throw Error('Reload this month before reviewing its calendar.');
 const output=copy(snapshot),rows={},excluded=[],renamed=[];
 const valid=key=>/^\d{1,2}$/.test(key)&&Number(key)>=1&&Number(key)<=count;
 for(const [key,value]of Object.entries(snapshot.currentSchedule))if(valid(key)&&String(Number(key))===key)rows[key]=copy(value);
 for(const [key,value]of Object.entries(snapshot.currentSchedule)){
  if(valid(key)&&String(Number(key))===key)continue;
  if(valid(key)&&!Object.hasOwn(rows,String(Number(key)))){const to=String(Number(key));rows[to]=copy(value);renamed.push({from:key,to});}
  else excluded.push({key,reason:valid(key)?'Duplicate day key':'Outside selected month',rows:copy(value)});
 }
 output.currentSchedule=rows;
 return {snapshot:output,month,count,excluded,renamed,changed:excluded.length>0||renamed.length>0};
}

export function scheduleCalendarError(plan){
 const keys=[...plan.excluded.map(row=>row.key),...plan.renamed.map(row=>row.from)];
 const error=Error(plan.month+' has '+plan.count+' days. Review calendar rows '+keys.join(', ')+' in Create Monthly Schedule, then use the corrected local draft and Save Edits. Your current draft has been kept.');
 error.code='schedule/calendar-review-needed';return error;
}

export function calendarReviewWarnings(plan){
 if(!plan.changed)return [];
 const rows=plan.excluded.map(row=>{
  const details=Object.entries(plain(row.rows)?row.rows:{}).map(([branch,value])=>{
   const names=[...Object.values(value?.scheduled||{}),...(value?.rest||[]),...(value?.unavailable||[]).map(item=>item?.name)].filter(name=>typeof name==='string'&&name&&!['N/A','UNFILLED'].includes(name));
   return branch+(names.length?': '+[...new Set(names)].join(', '):': no named staff');
  }).join(' · ');
  return 'Extra calendar row '+row.key+' ('+row.reason+'): '+(details||'Saved row details retained in backup')+'. It cannot be placed on a real date in this month; no replacement date will be guessed.';
 });
 return [plan.month+' has '+plan.count+' days. Before applying this calendar repair, the complete original draft will be preserved as a separate local recovery copy. Valid work dates stay unchanged by the calendar repair.',...rows,...plan.renamed.map(row=>'Calendar key '+row.from+' will use day '+row.to+' with the same saved assignments.')];
}
