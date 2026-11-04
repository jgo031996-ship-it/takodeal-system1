// Unpaid payroll uses protected, source-linked Owner confirmations. The original
// punch and its lateness decision stay untouched; the calculator revalidates
// this evidence before using the reviewed hours.
import {attendanceKind,attendanceMillis,linkedAttendanceHistory} from './attendance-reconcile.js';
import {ATTENDANCE_METADATA_FIELDS} from './attendance-metadata-reader.js';
import {resolveEmergencyShift} from './emergency-shift-model.js';
const OWNER_EMAIL='jgo031996@gmail.com';

const active=row=>row&&!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status);
const key=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
const id=value=>typeof value==='string'&&value.length>0&&value!=='.'&&value!=='..'&&!/[\/\u0000-\u001f\u007f-\u009f]/.test(value)&&new TextEncoder().encode(value).length<=1500;
const canonical=value=>{
 if(value instanceof Date||typeof value?.toDate==='function'||typeof value?.toMillis==='function'||value&&typeof value==='object'&&Number.isFinite(value.seconds)){
  const milliseconds=attendanceMillis(value);if(!Number.isFinite(milliseconds))throw Error('The saved attendance timestamp needs review.');
  return {seconds:Number.isFinite(value?.seconds)?value.seconds:Math.floor(milliseconds/1000),nanoseconds:Number.isFinite(value?.nanoseconds)?value.nanoseconds:Math.round((milliseconds%1000+1000)%1000*1e6)};
 }
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(name=>value[name]!==undefined).map(name=>[name,canonical(value[name])]));
 return value??null;
};
async function fingerprint(value){const bytes=new TextEncoder().encode(JSON.stringify(canonical(value))),result=await globalThis.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('');}
const attendanceEvidence=row=>Object.fromEntries(['id',...ATTENDANCE_METADATA_FIELDS,'penaltyAmount'].filter(field=>Object.hasOwn(row,field)).map(field=>[field,row[field]]));
const fresh=(snapshot,expected)=>{if(!snapshot||snapshot.id!==expected||typeof snapshot.exists!=='function'||snapshot.metadata?.fromCache===true||snapshot.metadata?.hasPendingWrites===true)throw Error('Reconnect to check the saved assigned-hours review.');return snapshot;};
const message='Assigned hours could not be confirmed with HQ for this Time In. Open its attendance review, then generate the unpaid payroll again.';
const pending=new WeakMap();
function boundedRead(api,reference,assertCurrent=()=>{}){
 const key=reference.path||reference.table+'/'+reference.id;let reads=pending.get(api);if(!reads){reads=new Map();pending.set(api,reads);}if(reads.has(key))return reads.get(key).result;
 const physical=Promise.resolve().then(()=>{assertCurrent();return api.getDocFromServer(reference);}),entry={};let timer;
 entry.result=Promise.race([physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),25000);})]).finally(()=>clearTimeout(timer));reads.set(key,entry);
 const release=()=>{if(reads.get(key)===entry)reads.delete(key);clearTimeout(timer);};physical.then(release,release);return entry.result;
}
async function boundedTasks(tasks,{assertCurrent,concurrency=4}){let next=0;await Promise.all(Array.from({length:Math.min(concurrency,tasks.length)},async()=>{while(next<tasks.length){assertCurrent();await tasks[next++]();assertCurrent();}}));}

export async function loadPayrollShiftConfirmations(api,input,{assertCurrent=()=>{},mapReads=boundedTasks,readDocument=reference=>boundedRead(api,reference,assertCurrent),from,to}={}){
 const first=from==null?-Infinity:Date.parse(from+'T00:00:00+08:00'),last=to==null?Infinity:Date.parse(to+'T23:59:59.999+08:00');
 if(Number.isNaN(first)||Number.isNaN(last)||first>last)throw Error('Choose valid dates before confirming assigned hours.');
 const profiles=input.staffSnap.docs.map(document=>({...document.data(),staffId:document.id,id:document.id}));
 const paid=new Set(input.prSnap.docs.filter(document=>{const row=document.data();return row.frozenData||row.isPaid===true||row.status==='Paid';}).map(document=>document.data().staffId||document.data().frozenData?.staffId).filter(id));
 const attendance=input.attSnap.docs.map(document=>({...document.data(),id:document.id})),starts=attendance.filter(row=>active(row)&&attendanceKind(row)==='TIME IN'&&id(row.id)&&!paid.has(row.staffId)&&attendanceMillis(row.timestamp)>=first-24*3600000&&attendanceMillis(row.timestamp)<=last);
 if(starts.length>2000)throw Error('Choose a shorter payroll period to confirm the assigned-hours records.');
 const seen=new Set(),candidates=starts.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true;});
 const confirmations={},errors={},evidence=[],pairings=new Map();
 if(!candidates.length)return {...input.scheduleData,payrollShiftConfirmations:confirmations,payrollShiftConfirmationErrors:errors,payrollShiftConfirmationEvidence:evidence};
 const work=candidates.map(start=>async()=>{
  assertCurrent();const linked=profiles.filter(person=>start.staffId?person.staffId===start.staffId:key(person.cashierName)===key(start.staffName)&&person.branch===start.branch),person=linked.length===1?linked[0]:null;
  // A missing/ambiguous employee is already an identity hold in the roster.
  // Do not attach another person's same-name confirmation to that record.
  if(!person)return;
  const pairingKey=JSON.stringify([person.staffId,start.staffName]);
  if(!pairings.has(pairingKey))pairings.set(pairingKey,new Map(linkedAttendanceHistory(attendance,person.staffId,start.staffName).filter(pair=>pair.in&&pair.out).map(pair=>[pair.in.id,pair.out])));
  const pairedOut=pairings.get(pairingKey).get(start.id),departures=attendance.filter(row=>active(row)&&attendanceKind(row)==='TIME OUT'&&row.timeInLogId===start.id);
  // The wider attendance query supplies overnight context. A shift completed
  // before this cutoff cannot contribute pay or require a new hours review.
  // Keep duplicate/conflicting closures for the planner to hold explicitly.
  if(attendanceMillis(start.timestamp)<first&&pairedOut&&attendanceMillis(pairedOut.timestamp)<first&&departures.every(row=>row.id===pairedOut.id))return;
  // Older receipts may use a legacy unlinked Time Out. Bind the same existing
  // pair the attendance planner consumes; never manufacture a departure.
  if(pairedOut&&!departures.some(row=>row.id===pairedOut.id))departures.push(pairedOut);
  const proof={attendanceLogId:start.id,staffId:person.staffId,staffName:start.staffName,branch:start.branch,sourceFingerprint:'',confirmationFingerprint:'',departures:[]};
  try{
   proof.sourceFingerprint=await fingerprint(attendanceEvidence(start));
   for(const out of departures)proof.departures.push({id:out.id,fingerprint:await fingerprint(attendanceEvidence(out))});
   proof.departures.sort((a,b)=>a.id.localeCompare(b.id));
   assertCurrent();if(typeof api.getDocFromServer!=='function')throw Error(message);
   const snapshot=fresh(await readDocument(api.doc(api.db,'attendance_shift_confirmations',start.id)),start.id);assertCurrent();const head=snapshot.exists()?snapshot.data():null;
   proof.confirmationFingerprint=await fingerprint(head);assertCurrent();
   if(head){if(head.reviewedByEmail!==OWNER_EMAIL)throw Error('The saved assigned hours need Owner review before they can change unpaid payroll.');resolveEmergencyShift(start,person,head);confirmations[start.id]=head;}
  }catch(error){assertCurrent();errors[start.id]=error.message||message;proof.readFailed=!proof.confirmationFingerprint;proof.reviewRequired=true;}
  assertCurrent();evidence.push(proof);
 });
 await mapReads(work,{assertCurrent,concurrency:4});assertCurrent();
 evidence.sort((a,b)=>a.attendanceLogId.localeCompare(b.attendanceLogId));
 return {...input.scheduleData,payrollShiftConfirmations:confirmations,payrollShiftConfirmationErrors:errors,payrollShiftConfirmationEvidence:evidence};
}

export async function loadStaffPayrollShiftConfirmations(api,{scheduleData,staffId,profile,attendanceRecords,start,end,assertCurrent=()=>{}}){
 if(!id(staffId)||!profile||!Array.isArray(attendanceRecords))throw Error('Reopen this Staff payroll account to confirm its assigned hours.');
 const selected=attendanceRecords.filter(row=>row.staffId?row.staffId===staffId:key(row.staffName)===key(profile.cashierName));
 return loadPayrollShiftConfirmations(api,{scheduleData,staffSnap:{docs:[{id:staffId,data:()=>profile}]},attSnap:{docs:selected.map(row=>({id:row.id,data:()=>row}))},prSnap:{docs:[]}}, {assertCurrent,from:start,to:end});
}

// Only this employee's records are re-read before payment. This includes absent
// confirmations, so a newly approved shift cannot leave an old unpaid preview
// payable. A failed read never substitutes the preview for server evidence.
export async function assertPayrollShiftConfirmationsFresh(api,data,rows,{assertCurrent=()=>{}}={}){
 if(!Array.isArray(rows)||!rows.length)return;
 const staffId=data.staffId||data.profile?.staffId||data.profile?.id,name=data.name||data.staffName;
 const selected=rows.filter(row=>staffId?row.staffId===staffId:key(row.staffName)===key(name));
 if(!selected.length){if(rows.some(row=>key(row.staffName)===key(name)))throw Error('The unpaid payroll employee identity changed. Generate this payroll again.');return;}
 if(!id(staffId)||selected.some(row=>row.staffId!==staffId||api.isBranchAllowed?.(row.branch)===false)||typeof api.getDocFromServer!=='function')throw Error('Regenerate this employee’s unpaid payroll to confirm the saved assigned hours.');
 let next=0;await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
  while(next<selected.length){const proof=selected[next++];assertCurrent();
   if(proof.readFailed||proof.reviewRequired||!id(proof.attendanceLogId)||!Array.isArray(proof.departures)||proof.departures.some(row=>!id(row.id)))throw Error(message);
   const [start,head,...outs]=await Promise.all([boundedRead(api,api.doc(api.db,'attendance_logs',proof.attendanceLogId),assertCurrent),boundedRead(api,api.doc(api.db,'attendance_shift_confirmations',proof.attendanceLogId),assertCurrent),...proof.departures.map(row=>boundedRead(api,api.doc(api.db,'attendance_logs',row.id),assertCurrent))]);assertCurrent();
   fresh(start,proof.attendanceLogId);fresh(head,proof.attendanceLogId);
   const source=start.exists()?{...start.data(),id:start.id}:null;
   if(!source||await fingerprint(attendanceEvidence(source))!==proof.sourceFingerprint||await fingerprint(head.exists()?head.data():null)!==proof.confirmationFingerprint)throw Error('Attendance or Owner-confirmed hours changed. Generate this unpaid payroll again before payment.');
   for(let index=0;index<outs.length;index++){fresh(outs[index],proof.departures[index].id);if(!outs[index].exists()||await fingerprint(attendanceEvidence({...outs[index].data(),id:outs[index].id}))!==proof.departures[index].fingerprint)throw Error('The saved actual Time Out changed. Generate this unpaid payroll again before payment.');}
   assertCurrent();
  }
 }));
}
