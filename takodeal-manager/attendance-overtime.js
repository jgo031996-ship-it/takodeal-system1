import {attendanceKind,attendanceMillis,linkedAttendanceHistory,readStaffRecords} from './attendance-reconcile.js';
import {createAttendanceMetadataReader} from './attendance-metadata-reader.js';
import {activeStaffProfile} from './staff-lifecycle-model.js';
import {canCorrectOwnerTimeOut} from './owner-time-out-correction.js';
import {resolveHQAccount,savedPin} from './hq-account-model.js';
import {OWNER_EMAIL,createWorkspaceSession,canOpenWorkspacePage} from './workspace-access-model.js';
import {staffRateDate,staffRateWorkDate,staffRateForDate,loadStaffSalaryTimeline,validRateDate} from './staff-rate-model.js';
import {nightRate,resolveAttendanceShift} from './payroll-safety.js';
import {ordinaryPayrollId} from './payroll-settlement.js';
import {createPayrollBonusHistoryStore} from './payroll-bonus-templates.js';
import {overtimeBonusId,overtimeAttendanceFingerprint,overtimeRecordFingerprint,overtimeWorkDateEvidence} from './payroll-overtime.js';

const validId=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\/\0]/.test(value);
const inactive=row=>!row||row.deleted||['Voided','Cancelled','Canceled','Deleted'].includes(row.status);
const iso=value=>Number.isFinite(attendanceMillis(value))?new Date(attendanceMillis(value)).toISOString():null;
const canonical=value=>value?.toDate||value&&typeof value==='object'&&Number.isSafeInteger(value.seconds)?iso(value):value instanceof Date?value.toISOString():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
const json=value=>JSON.stringify(canonical(value));
const hash=async value=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(json(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const safeLog=row=>Object.fromEntries(['id','staffId','staffName','branch','type','timestamp','status','deleted','isManual','source','timeInLogId','timeInAt','attendanceVersion','scheduleSnapshot'].filter(key=>row?.[key]!==undefined).map(key=>[key,canonical(row[key])]));
const fresh=snap=>{if(!snap||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||snap.docs?.some(row=>row.metadata?.fromCache||row.metadata?.hasPendingWrites))throw Error('Reconnect to confirm the saved attendance, bonus and payroll.');return snap;};
const rows=snap=>{fresh(snap);if(!Array.isArray(snap.docs))throw Error('HQ returned an incomplete history.');return snap.docs.map(row=>({...row.data(),id:row.id}));};
const actorKey=api=>{if(!canCorrectOwnerTimeOut(api))throw Error('Only the verified Owner can manage attendance OT bonuses.');return json([api.auth.currentUser.uid,api.auth.currentUser.email,api.sessionUser.uid,api.sessionUser.email,api.sessionUser.permissions,api.sessionUser.allowedBranches]);};
const accountView=row=>Object.fromEntries(['id','email','role','permissions','allowedBranches','assignedBranch','branch','active','archived','blocked','status'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
const profileView=row=>Object.fromEntries(['id','staffId','cashierName','branch','active','archived','blocked','status','hourlyRate','dailyRate','nightDiffRate','eligibleNightDiff','salaryRateVersion','salaryRateRevision','scheduleAliases'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
function authority(api,key,accounts,branch){
 if(actorKey(api)!==key||branch&&api.isBranchAllowed?.(branch)===false)throw Error('The Owner account or branch access changed.');
 const account=resolveHQAccount(accounts.map(row=>({id:row.id,data:row})));
 if(!account||account.active===false||account.archived===true||account.blocked===true||/blocked|disabled|inactive|revoked|terminated|resigned|deleted/i.test(String(account.status||''))||/^(REVOKED|BLOCKED)$/i.test(savedPin(account)))throw Error('The saved Owner account is inactive.');
 const session=createWorkspaceSession(api.auth.currentUser,account);if(!session.isOwner||!canOpenWorkspacePage(session,'payroll'))throw Error('Saved Owner payroll access is required.');
}
function paidWorkDate(record){return record?.frozenData||record?.isPaid===true||Number.isFinite(record?.finalNetPay);}
function paidCoverage(records,date,staffId,names){
 names=Array.isArray(names)?names:[names];
 const result=[];
 for(const row of records){
  const savedId=row.staffId||row.frozenData?.staffId||row.frozenData?.profile?.staffId||row.frozenData?.profile?.id;
  if(savedId&&savedId!==staffId)continue;
  if(!savedId&&!names.includes(row.staffName)&&!names.includes(row.frozenData?.name))continue;
  if(!paidWorkDate(row))continue;
  if(!validRateDate(row.startDate)||!validRateDate(row.endDate)||row.startDate>row.endDate)throw Error('A saved paid payroll has incomplete dates. Review that history before changing OT.');
  if(row.startDate<=date&&row.endDate>=date)result.push(row);
 }
 return result;
}
export function attendanceOvertimeAmount(view,hours){
 if(typeof hours!=='number'||!Number.isFinite(hours)||hours<=0||hours>24)throw Error('Enter OT hours greater than zero and no more than 24.');
 if(!Number.isFinite(view?.hourlyRate)||view.hourlyRate<=0)throw Error('The daily wage for this work date could not be confirmed.');
 const amount=Math.round(hours*view.hourlyRate*100)/100;if(!Number.isFinite(amount)||amount<=0)throw Error('The calculated OT bonus must be greater than zero.');return amount;
}
export function createAttendanceOvertimeService(api,{readAttendance,readSchedule,timeoutMs=25000}={}){
 const pending=new Map(),ref=(table,id)=>api.doc(api.db,table,id);let metadata;
 const read=async reference=>{const snap=fresh(await api.getDocFromServer(reference));if(typeof snap.exists!=='function')throw Error('HQ returned an incomplete record.');return snap.exists()?{...snap.data(),id:snap.id||reference.id}:null;};
 const query=async(table,field,value,cap=501)=>{if(typeof api.limit!=='function')throw Error('Reload the updated Owner app to confirm bounded OT history.');const found=rows(await api.getDocsFromServer(api.query(api.collection(api.db,table),api.where(field,'==',value),api.limit(cap))));if(found.length>=cap)throw Error('This saved history needs a separate payroll review.');return found;};
 async function people(staffId,name){
  if(staffId){if(!validId(staffId))throw Error('Open a saved employee first.');const profile=await read(ref('cashiers',staffId));if(!profile)throw Error('The saved employee profile is unavailable. Review it first.');if(name&&profile.cashierName!==name){const others=await query('cashiers','cashierName',name,3);if(others.some(row=>row.id!==profile.id))throw Error('This attendance ID and name identify different employees. Review the original record.');}return profile;}
  const matches=await query('cashiers','cashierName',name,3);if(matches.length!==1)throw Error('This name-only record does not identify one employee. Review its identity first.');return matches[0];
 }
 async function base(staffId,name,key){
  const profile=await people(staffId,name),accounts=await query('hq_managers','email',OWNER_EMAIL,11);if(!accounts.length||accounts.length>10)throw Error('The saved Owner account needs review.');authority(api,key,accounts,profile.branch);
  const bonuses=new Map(),paid=new Map(),names=[...new Set([profile.cashierName,name,...(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[])].filter(value=>typeof value==='string'&&value.trim()))];
  if(names.length>21)throw Error('This employee has too many saved names for one OT review.');
  for(const alias of names){const matches=new Map();for(const row of await query('cashiers','cashierName',alias,3))matches.set(row.id,row);for(const row of await rows(await api.getDocsFromServer(api.query(api.collection(api.db,'cashiers'),api.where('scheduleAliases','array-contains',alias),api.limit(3)))))matches.set(row.id,row);if([...matches.keys()].some(id=>id!==profile.id))throw Error('A saved employee name is shared by another profile. Review the identity before changing OT.');}
  for(const [field,value]of [['staffId',profile.id],...names.map(value=>['staffName',value])]){
   for(const row of await query('staff_bonuses',field,value))if(row.type==='Overtime'&&(!row.staffId||row.staffId===profile.id))bonuses.set(row.id,row);
   for(const row of await query('payroll_records',field,value))paid.set(row.id,row);
  }
  if(bonuses.size>500||paid.size>500)throw Error('This employee has a large history that needs a separate payroll review.');authority(api,key,accounts,profile.branch);
  return {profile,accounts,names,bonuses:[...bonuses.values()],paid:[...paid.values()]};
 }
 async function guardRows(state,dates){
  const ids=new Set();for(const date of dates){const month=date.slice(0,7),day=Number(date.slice(8)),last=new Date(Date.UTC(Number(date.slice(0,4)),Number(date.slice(5,7)),0)).getUTCDate(),from=month+(day<=15?'-01':'-16'),to=month+(day<=15?'-15':'-'+last),id=ordinaryPayrollId(state.profile.id,from,to);ids.add(id);ids.add('refund-'+id);}
  const guards=await Promise.all([...ids].map(async id=>({id,row:await read(ref('payroll_records',id))})));for(const guard of guards)if(guard.row&&!state.paid.some(row=>row.id===guard.id))state.paid.push(guard.row);return guards;
 }
 const bonusDate=row=>{if(row.workDate)return staffRateDate(row.workDate);if(!Number.isFinite(attendanceMillis(row.dateAdded)))throw Error('This OT bonus has no valid saved work date. Review payroll history first.');return staffRateDate(row.dateAdded);};
 async function historyState(staffId,key){const state=await base(staffId,null,key);state.guards=await guardRows(state,[...new Set(state.bonuses.map(bonusDate))]);return state;}
 function bonusView(row,state){let date=null,hold='';try{date=bonusDate(row);if(row.status==='Paid'||row.payrollRecordId||paidCoverage(state.paid,date,state.profile.id,state.names).length)hold='Included in paid payroll; use a separate payroll adjustment.';}catch(error){hold=error.message;}
  if(!['Unpaid',undefined,'Cancelled'].includes(row.status))hold='The saved bonus status needs payroll review.';
  if(row.staffId?row.staffId!==state.profile.id:!state.names.includes(row.staffName))hold='The saved employee name changed. Review its identity before removal.';
  if(!Number.isFinite(row.amount)||row.amount<=0||typeof row.hours!=='number'||!Number.isFinite(row.hours)||row.hours<=0)hold='The saved OT amount or hours needs payroll review.';
  return {id:row.id,staffId:state.profile.id,staffName:state.profile.cashierName,workDate:date,amount:row.amount,hours:row.hours,remarks:row.remarks||'',status:row.status==='Cancelled'?'Cancelled':hold?'Paid / review':'Unpaid',legacy:row.otVersion!==1,sourceTimeOutId:row.timeOutLogId||null,canCancel:row.status!=='Cancelled'&&!hold,hold,cancellationReason:row.cancellationReason||'',previous:Array.isArray(row.overtimeHistory)?row.overtimeHistory.map(prior=>({revision:prior.otRevision,amount:prior.amount,hours:prior.hours,status:prior.status,reason:prior.remarks,cancellationReason:prior.cancellationReason})):[],expectedFingerprint:overtimeRecordFingerprint(row)};
 }
 async function prepare(timeOutId,key){
  if(!validId(timeOutId))throw Error('Choose an exact saved Time Out.');const out=await read(ref('attendance_logs',timeOutId));
  if(inactive(out)||attendanceKind(out)!=='TIME OUT'||!Number.isFinite(attendanceMillis(out.timestamp)))throw Error('This saved Time Out is unavailable or needs attendance review.');
  const state=await base(out.staffId,out.staffName,key),profile=state.profile;
  metadata||=api.readStaffMetadata||createAttendanceMetadataReader({...api.deviceFleetConnection,auth:api.auth,fetch:api.fetch?.bind(api)||globalThis.fetch});
  const history=readAttendance?await readAttendance({staffId:profile.id,staffName:profile.cashierName}):await readStaffRecords({...api,readStaffMetadata:metadata},profile.id,profile.cashierName,{metadataOnly:true,names:state.names,resolveLegacyIdentity:async legacyName=>state.names.includes(legacyName),assertCurrent:()=>authority(api,key,state.accounts,profile.branch)});
  if(!Array.isArray(history)||history.length>5000||history.some(row=>!validId(row.id)||attendanceKind(row)&&!inactive(row)&&!Number.isFinite(attendanceMillis(row.timestamp))))throw Error('The saved attendance history needs review.');
  const pair=linkedAttendanceHistory(history,profile.id,profile.cashierName,new Date(),state.names).find(row=>row.out?.id===timeOutId);
  if(!pair?.in||!pair.out||pair.status!=='Complete'||pair.in.branch!==out.branch||json(safeLog(pair.out))!==json(safeLog(out)))throw Error('This Time Out does not have one confirmed original Time In. Review the shift first.');
  const starts=history.filter(row=>row.id===pair.in.id),outs=history.filter(row=>row.timeInLogId===pair.in.id&&attendanceKind(row)==='TIME OUT'&&!inactive(row));if(starts.length!==1||outs.length>1)throw Error('Conflicting attendance records need review before adding OT.');
  const timeIn=await read(ref('attendance_logs',pair.in.id));if(!timeIn||json(safeLog(timeIn))!==json(safeLog(pair.in)))throw Error('The original Time In changed during its metadata check. Refresh attendance.');const preDate=staffRateDate(timeIn.timestamp),scheduleRows=new Map(),scoped=Object.create(api);
  Object.defineProperty(scoped,'getDocFromServer',{value:async reference=>{const snapshot=fresh(await api.getDocFromServer(reference));scheduleRows.set(reference.path,{reference,row:snapshot.exists()?{...snapshot.data(),id:snapshot.id||reference.id}:null});return snapshot;}});
  const schedule=readSchedule?await readSchedule(preDate):await createPayrollBonusHistoryStore(scoped).loadRange(staffRateDate(new Date(Date.parse(preDate+'T00:00:00+08:00')-86400000)),preDate),shift=resolveAttendanceShift(timeIn,schedule,{[profile.cashierName]:profile}),workDate=staffRateWorkDate(timeIn,shift),salary=await loadStaffSalaryTimeline(api,{...profile,staffId:profile.id});
  const dailyRate=staffRateForDate(salary,workDate),appliedNightRate=shift.isNightShift?nightRate(profile):0,hourlyRate=(dailyRate+appliedNightRate)/8;
  if(dailyRate===null||!Number.isFinite(hourlyRate)||hourlyRate<=0)throw Error('The saved daily wage for this work date needs review.');
  state.guards=await guardRows(state,[workDate,...new Set(state.bonuses.map(bonusDate))]);
  const id=overtimeBonusId(timeOutId),target=await read(ref('staff_bonuses',id));if(target?.type==='Overtime'&&!state.bonuses.some(row=>row.id===id))state.bonuses.push(target);
  const attendanceFingerprint=await overtimeAttendanceFingerprint({timeIn,timeOut:out,staffId:profile.id});
  const workDateEvidence=overtimeWorkDateEvidence(timeIn,shift),source={attendanceFingerprint,timeIn:safeLog(timeIn),timeOut:safeLog(out),profile:profileView(profile),workDate,workDateEvidence,dailyRate,appliedNightRate,hourlyRate,slot:target?{status:target.status,revision:target.otRevision,grantFingerprint:target.grantFingerprint,cancelledAt:target.cancelledAt,cancellationReason:target.cancellationReason}:null,shift:{isNightShift:shift.isNightShift===true,shiftName:shift.shiftName||'',expectedStartAt:iso(shift.expectedStartAt),expectedEndAt:iso(shift.expectedEndAt)},salary:salary.salaryRateTimeline||null,schedule:[...scheduleRows].map(([path,value])=>({path,row:value.row}))};
  const sourceFingerprint=await hash(source),sameDate=state.bonuses.filter(row=>row.status!=='Cancelled'&&bonusDate(row)===workDate&&(row.otVersion!==1||row.timeOutLogId===timeOutId)),paid=paidCoverage(state.paid,workDate,profile.id,state.names);
  const canGrant=activeStaffProfile(profile)&&!paid.length&&!sameDate.length&&(!target||target.status==='Cancelled'&&!target.payrollRecordId);
  authority(api,key,state.accounts,out.branch);return {...state,id,target,timeIn,out,history:[timeIn,out],scheduleRows,workDate,dailyRate,appliedNightRate,hourlyRate,source,sourceFingerprint,attendanceFingerprint,canGrant,hold:paid.length||target?.payrollRecordId||target?.type==='Attendance OT Payroll Lock'?'A paid payslip covers this shift. Use a separate payroll adjustment.':sameDate.length?'An OT bonus is already saved for this shift or an unlinked bonus exists on this work date. Review its history before adding another.':target&&target.status!=='Cancelled'?'This shift already has an OT history entry.':!activeStaffProfile(profile)?'This employee is inactive.':'',paidCutoffs:paid.map(row=>({id:row.id,from:row.startDate,to:row.endDate}))};
 }
 function view(state){return {timeOutId:state.out.id,timeInId:state.timeIn.id,staffId:state.profile.id,staffName:state.profile.cashierName,branch:state.out.branch,workDate:state.workDate,timeInAt:iso(state.timeIn.timestamp),timeOutAt:iso(state.out.timestamp),dailyRate:state.dailyRate,appliedNightRate:state.appliedNightRate,hourlyRate:state.hourlyRate,sourceFingerprint:state.sourceFingerprint,canGrant:state.canGrant,hold:state.hold,bonuses:state.bonuses.map(row=>bonusView(row,state)).sort((a,b)=>(b.workDate||'').localeCompare(a.workDate||'')||a.id.localeCompare(b.id))};}
 async function locked(state,key,work){
  const bonuses=state.transactionBonuses||state.bonuses,paid=state.transactionPaid||state.paid;
  const refs=new Map();for(const [table,list]of [['hq_managers',state.accounts],['staff_bonuses',bonuses],['payroll_records',paid],['attendance_logs',state.history||[]]])for(const row of list)refs.set(table+'/'+row.id,ref(table,row.id));for(const guard of state.guards)refs.set('payroll_records/'+guard.id,ref('payroll_records',guard.id));for(const [path,value]of state.scheduleRows||[])refs.set(path,value.reference);refs.set('cashiers/'+state.profile.id,ref('cashiers',state.profile.id));if(state.id)refs.set('staff_bonuses/'+state.id,ref('staff_bonuses',state.id));if(state.profile.salaryRateVersion===1&&state.source)refs.set('staff_salary_rates/'+state.profile.id,ref('staff_salary_rates',state.profile.id));if(refs.size>480)throw Error('This history is too large for one safe OT change.');
  return api.runTransaction(api.db,async tx=>{const live=new Map(await Promise.all([...refs].map(async([path,reference])=>{const snap=await tx.get(reference);return [path,snap.exists()?{...snap.data(),id:snap.id||reference.id}:null];}))),get=(table,id)=>live.get(table+'/'+id);
   const accounts=state.accounts.map(row=>get('hq_managers',row.id)).filter(Boolean);authority(api,key,accounts,state.out?.branch||state.profile.branch);
   if(json(profileView(get('cashiers',state.profile.id)||{}))!==json(profileView(state.profile))||state.source&&!activeStaffProfile(get('cashiers',state.profile.id)))throw Error('The saved staff profile or rate changed. Refresh this exact shift.');
   for(const row of state.accounts)if(json(accountView(get('hq_managers',row.id)||{}))!==json(accountView(row)))throw Error('The saved Owner access changed.');
   for(const [table,list]of [['staff_bonuses',bonuses],['payroll_records',paid]])for(const row of list)if(json(get(table,row.id))!==json(row)||table==='staff_bonuses'&&overtimeRecordFingerprint(get(table,row.id)||{})!==overtimeRecordFingerprint(row))throw Error('The saved bonus or paid payroll changed. Refresh its latest result.');
   for(const guard of state.guards)if(json(get('payroll_records',guard.id))!==json(guard.row))throw Error('A payroll payment changed during OT review. Refresh first.');
   for(const row of state.history||[])if(json(safeLog(get('attendance_logs',row.id)))!==json(safeLog(row)))throw Error('The saved attendance changed. Refresh this exact shift.');
   if(state.timeIn&&await overtimeAttendanceFingerprint({timeIn:get('attendance_logs',state.timeIn.id),timeOut:get('attendance_logs',state.out.id),staffId:state.profile.id})!==state.attendanceFingerprint)throw Error('The exact saved attendance evidence changed. Refresh this shift.');
   for(const [path,value]of state.scheduleRows||[])if(json(live.get(path))!==json(value.row))throw Error('The saved schedule changed. Review this work date and OT rate again.');
   if(state.profile.salaryRateVersion===1&&state.source){const salary=get('staff_salary_rates',state.profile.id);if(!salary||json(Object.fromEntries(Object.entries(salary).filter(([key])=>key!=='id')))!==json(state.source.salary))throw Error('Dated salary changed. Refresh this exact shift.');}
   authority(api,key,accounts,state.out?.branch||state.profile.branch);return work(tx,get);
  });
 }
 function bounded(key,intent,work){const prior=pending.get(key);if(prior){if(prior.intent!==intent)return Promise.reject(Error('The original OT change is still pending. Refresh its result before changing it.'));return prior.promise;}const entry={intent,physical:Promise.resolve().then(work)};pending.set(key,entry);let timer;entry.promise=Promise.race([entry.physical,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('HQ has not confirmed this OT change yet. It may still finish. Refresh this same shift before retrying.'),{code:'attendance-ot/pending',settled:entry.physical})),timeoutMs);})]).finally(()=>clearTimeout(timer));entry.physical.then(()=>pending.get(key)===entry&&pending.delete(key),()=>pending.get(key)===entry&&pending.delete(key));return entry.promise;}
 return {
  isSaving:()=>pending.size>0,
  async inspect(timeOutId){const key=actorKey(api);return view(await prepare(timeOutId,key));},
  async history(staffId){const key=actorKey(api),state=await historyState(staffId,key);return {staffId:state.profile.id,staffName:state.profile.cashierName,branch:state.profile.branch,bonuses:state.bonuses.map(row=>bonusView(row,state)).sort((a,b)=>(b.workDate||'').localeCompare(a.workDate||''))};},
  grant(input){let key;try{key=actorKey(api);if(!validId(input.timeOutId)||typeof input.reason!=='string'||input.reason.trim().length<8||input.reason.trim().length>1000)throw Error('Explain the OT bonus using 8 to 1,000 characters.');}catch(error){return Promise.reject(error);}return bounded('grant|'+input.timeOutId,json(input),async()=>{
   const state=await prepare(input.timeOutId,key),amount=attendanceOvertimeAmount(state,input.hours),reason=input.reason.trim();
   const same=row=>row?.otVersion===1&&row.status!=='Cancelled'&&row.staffId===state.profile.id&&row.timeOutLogId===state.out.id&&row.timeInLogId===state.timeIn.id&&row.workDate===state.workDate&&row.hours===input.hours&&row.amount===amount&&row.grantFingerprint===input.expectedFingerprint&&row.sourceFingerprint===state.attendanceFingerprint&&row.remarks===reason;
   if(state.target&&state.target.status!=='Cancelled'){if(same(state.target))return {alreadySaved:true,id:state.id,amount};throw Error('This shift already has a different OT history entry. Refresh it before proceeding.');}
   if(!state.canGrant)throw Error(state.hold);if(state.sourceFingerprint!==input.expectedFingerprint)throw Error('The attendance or rate changed. Review the work date and amount again.');
   state.transactionBonuses=state.bonuses.filter(row=>bonusDate(row)===state.workDate);state.transactionPaid=state.paid.filter(row=>row.startDate<=state.workDate&&row.endDate>=state.workDate);state.guards=state.guards.filter(guard=>guard.id.includes(state.workDate.slice(0,7)));
   return locked(state,key,(tx,get)=>{const prior=get('staff_bonuses',state.id);if(prior&&prior.status!=='Cancelled')throw Error('An OT entry was saved concurrently. Refresh its result.');if(prior&&(!Array.isArray(prior.overtimeHistory||[])||(prior.overtimeHistory||[]).length>=30||!Number.isSafeInteger(prior.otRevision)||prior.otRevision<1))throw Error('The saved OT revision history needs payroll review.');const stamp=api.serverTimestamp(),history=prior?[...(prior.overtimeHistory||[]),Object.fromEntries(Object.entries(prior).filter(([key])=>!['id','overtimeHistory'].includes(key)))]:[];tx.set(ref('staff_bonuses',state.id),{otVersion:1,otRevision:(prior?.otRevision||0)+1,overtimeHistory:history,type:'Overtime',status:'Unpaid',staffId:state.profile.id,staffName:state.profile.cashierName,branch:state.out.branch,workDate:state.workDate,workDateEvidence:state.source.workDateEvidence,timeInLogId:state.timeIn.id,timeOutLogId:state.out.id,dateAdded:new Date(state.workDate+'T12:00:00+08:00'),amount,hours:input.hours,remarks:reason,sourceFingerprint:state.attendanceFingerprint,grantFingerprint:input.expectedFingerprint,loggedBy:api.auth.currentUser.email,createdByUid:api.auth.currentUser.uid,createdByEmail:api.auth.currentUser.email,timestamp:stamp});return {saved:true,id:state.id,amount};});
  });},
  cancel(input){let key;try{key=actorKey(api);if(!validId(input.bonusId)||!validId(input.staffId)||typeof input.reason!=='string'||input.reason.trim().length<8||input.reason.trim().length>1000)throw Error('Explain the removal using 8 to 1,000 characters.');}catch(error){return Promise.reject(error);}return bounded('cancel|'+input.bonusId,json(input),async()=>{
   const state=await historyState(input.staffId,key),row=state.bonuses.find(row=>row.id===input.bonusId);if(!row)throw Error('This OT record could not be found for the saved employee.');if(row.status==='Cancelled'){if(row.cancellationReason===input.reason.trim())return {alreadySaved:true,id:row.id,cancelled:true};throw Error('This OT bonus was already removed.');}const checked=bonusView(row,state);if(!checked.canCancel)throw Error(checked.hold);if(checked.expectedFingerprint!==input.expectedFingerprint)throw Error('The saved OT changed. Refresh its history before removing it.');
   const date=bonusDate(row);state.transactionBonuses=[row];state.transactionPaid=state.paid.filter(row=>row.startDate<=date&&row.endDate>=date);state.guards=state.guards.filter(guard=>guard.id.includes(date.slice(0,7)));
   return locked(state,key,(tx,get)=>{const live=get('staff_bonuses',row.id);if(live.status==='Paid'||live.payrollRecordId)throw Error('This bonus was included in paid payroll. Use a separate adjustment.');tx.update(ref('staff_bonuses',row.id),{status:'Cancelled',cancellationReason:input.reason.trim(),cancelledAt:api.serverTimestamp(),cancelledBy:api.auth.currentUser.email,cancelledByUid:api.auth.currentUser.uid});return {saved:true,id:row.id,cancelled:true};});
  });}
 };
}
