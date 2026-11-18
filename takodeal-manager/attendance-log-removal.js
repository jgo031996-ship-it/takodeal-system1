import {attendanceKind,attendanceMillis,linkedTimeOutId} from './attendance-reconcile.js';
import {canOpenWorkspacePage} from './workspace-access-model.js';
import {staffRateDate,staffRateWorkDate,validRateDate} from './staff-rate-model.js';
import {ordinaryPayrollId} from './payroll-settlement.js';
import {overtimeBonusId} from './payroll-overtime.js';

const active=row=>row&&!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status);
const reviewed=row=>row&&['scheduleAmendmentReview','reliefScheduleReview'].some(field=>Object.hasOwn(row,field));
const paid=row=>row&&(row.isPaid===true||row.frozenData||Number.isFinite(row.finalNetPay)||row.status==='Paid');
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=200&&!id.includes('/');

function cutoffIds(staffId,day){
 const month=day.slice(0,7),firstHalf=day.slice(-2)<='15';
 const last=new Date(Date.UTC(Number(day.slice(0,4)),Number(day.slice(5,7)),0)).getUTCDate();
 const id=ordinaryPayrollId(staffId,month+(firstHalf?'-01':'-16'),month+(firstHalf?'-15':'-'+last));
 return [id,'refund-'+id];
}

export async function removeAttendancePunch(api,selected){
 const user=api.auth?.currentUser,session=api.sessionUser;
 const assertAccess=()=>{
  if(!user?.uid||user!==api.auth?.currentUser||session!==api.sessionUser||session?.uid!==user.uid||
   !canOpenWorkspacePage(session,'payroll')||session.isFranchisee||!api.isBranchAllowed(selected.branch)){
   throw Error('Unlock the Owner workspace with your payroll account and reopen this punch.');
  }
 };
 assertAccess();
 if(!validId(selected.id)||!['TIME IN','TIME OUT'].includes(attendanceKind(selected))||!Number.isFinite(attendanceMillis(selected.timestamp)))throw Error('Refresh attendance and select a saved punch.');
 // Refresh this account's Firebase credential before checking a protected write.
 await user.getIdToken(true);assertAccess();
 const ref=(table,id)=>api.doc(api.db,table,id);
 const read=async r=>{const snap=await api.getDocFromServer(r);if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Reconnect to HQ before removing attendance.');return snap.exists()?{...snap.data(),id:snap.id}:null;};
 const search=async(table,field,value)=>{
  const snap=await api.getDocsFromServer(api.query(api.collection(api.db,table),api.where(field,'==',value),api.limit(501)));
  if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||snap.docs.length>=501)throw Error('HQ could not confirm the complete records for this punch.');
  return snap.docs.map(d=>({...d.data(),id:d.id}));
 };
 const same=row=>row&&row.staffName===selected.staffName&&row.branch===selected.branch&&row.type===selected.type&&
  attendanceMillis(row.timestamp)===attendanceMillis(selected.timestamp)&&(row.staffId||'')===(selected.staffId||'')&&(row.timeInLogId||'')===(selected.timeInLogId||'');
 const target=ref('attendance_logs',selected.id),source=await read(target);
 if(!active(source))return {alreadyRemoved:true};
 if(!same(source))throw Error('This punch changed. Refresh the feed and select the saved entry again.');
 if(reviewed(source))throw Error('This punch has a saved HR decision. Open HR Review Center to review that decision.');
 const isStart=attendanceKind(source)==='TIME IN';
 const [people,linked,begin]=await Promise.all([
  source.staffId?read(ref('cashiers',source.staffId)).then(row=>row?[row]:[]):search('cashiers','cashierName',source.staffName),
  isStart?search('attendance_logs','timeInLogId',source.id):[],
  !isStart&&source.timeInLogId?read(ref('attendance_logs',source.timeInLogId)):null
 ]);
 if(people.length!==1)throw Error('The employee for this punch could not be uniquely identified. Review the staff profile first.');
 const profile=people[0],id=profile.id;
 if(linked.some(active))throw Error('A saved Time Out refers to this Time In. Review that departure before removing its start.');
 if(begin?.reliefScheduleReview)throw Error('This departure belongs to an HR-reviewed cover shift. Open HR Review Center for the original Time In.');
 if(source.timeInLogId&&(!active(begin)||begin.branch!==source.branch||begin.staffId&&begin.staffId!==id))throw Error('The linked Time In needs HR review.');
 const names=new Set([source.staffName,profile.cashierName,...(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[])].filter(Boolean));
 const lookup=[['staffId',id],...[...names].map(name=>['staffName',name])];
 const payRows=(await Promise.all(lookup.map(([field,value])=>search('payroll_records',field,value)))).flat();
 const workDays=new Set([staffRateWorkDate(begin||source),staffRateDate(source.timestamp)]);
 // A legacy departure without a link can close the previous day's shift.
 if(!isStart&&!begin)workDays.add(staffRateDate(new Date(attendanceMillis(source.timestamp)-86400000)));
 const belongs=row=>{const savedId=row?.staffId||row?.frozenData?.staffId||row?.frozenData?.profile?.id;return !savedId||savedId===id;};
 const covers=row=>paid(row)&&belongs(row)&&(!validRateDate(row.startDate)||!validRateDate(row.endDate)||[...workDays].some(day=>row.startDate<=day&&day<=row.endDate));
 if(payRows.some(covers))throw Error('A paid payslip covers this work date. Open the saved payslip to review an adjustment.');
 const payIds=new Set([...workDays].flatMap(day=>cutoffIds(id,day)));
 for(const row of payRows)if(belongs(row)&&[...workDays].some(day=>row.startDate<=day&&day<=row.endDate))payIds.add(row.id);
 const canonical=isStart?await linkedTimeOutId(id,source.id):null;
 const canonicalOut=!isStart&&begin&&source.id===await linkedTimeOutId(id,begin.id);
 const auditRef=canonicalOut?api.doc(api.collection(api.db,'attendance_logs')):null;
 const live=async(tx,r)=>{const snap=await tx.get(r);return snap.exists()?snap.data():null;};
 assertAccess();
 return api.runTransaction(api.db,async tx=>{
  const [row,start,out,bonus,payments]=await Promise.all([
   live(tx,target),begin?live(tx,ref('attendance_logs',begin.id)):null,canonical?live(tx,ref('attendance_logs',canonical)):null,
   !isStart?live(tx,ref('staff_bonuses',overtimeBonusId(source.id))):null,
   Promise.all([...payIds].map(key=>live(tx,ref('payroll_records',key))))
  ]);
  assertAccess();
  if(!active(row))return {alreadyRemoved:true};
  if(!same(row)||reviewed(row)||begin&&(!active(start)||start.reliefScheduleReview||attendanceMillis(start.timestamp)!==attendanceMillis(begin.timestamp)))throw Error('Attendance or its HR decision changed. Refresh the punch before continuing.');
  if(active(out))throw Error('A Time Out was saved for this Time In. Review the departure first.');
  if(bonus&&bonus.status!=='Cancelled')throw Error('This departure has a linked OT bonus or paid payroll. Review its OT history before removing it.');
  if(payments.some(covers))throw Error('A payment was saved for this work date. Review the paid payslip.');
  const audit={deleted:true,status:'Voided',voidedAt:api.serverTimestamp(),voidedByUid:user.uid,voidedBy:user.email};
  if(canonicalOut){
   // Release the deterministic Time Out ID so a corrected departure can be saved.
   tx.set(auditRef,{...row,...audit,originalAttendanceLogId:source.id});
   tx.delete(target);
  }else tx.update(target,audit);
  return {removed:true};
 });
}
