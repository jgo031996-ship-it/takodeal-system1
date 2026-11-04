import {OWNER_EMAIL,canOpenWorkspacePage} from './workspace-access-model.js';
import {assertPayrollScheduleFresh} from './payroll-schedule-freshness.js';
import {attendanceMillis} from './attendance-reconcile.js';

const states=new WeakMap();
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const when=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
function cents(value,{positive=false}={}){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||positive&&value<=0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.000001)throw Error('The saved daily wage or bonus amount needs a fresh payroll review.');
 return Math.round(value*100);
}
function instant(value){
 if(typeof value==='boolean'||typeof value==='number'||value==null||typeof value==='string'&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))throw Error('Regenerate this payslip with the original actual Time In and Time Out.');
 const at=attendanceMillis(value);if(!Number.isFinite(at))throw Error('The original attendance times need a fresh payroll review.');return at;
}
function owner(api){
 const user=api.auth?.currentUser,session=api.sessionUser;
 if(!user?.uid||user.email?.toLowerCase()!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||session.email?.toLowerCase()!==OWNER_EMAIL||session.isOwner!==true||session.isFranchisee===true||!canOpenWorkspacePage(session,'payroll'))throw Error('The verified Owner must review straight duty in this unpaid payslip.');
 return JSON.stringify([user.uid,user.email,session.uid,session.email,session.permissions,session.allowedBranches,session.isOwner]);
}
function rowFacts(log){
 const sourceAttendanceId=log?.attendanceLogId;
 if(typeof sourceAttendanceId!=='string'||!sourceAttendanceId||sourceAttendanceId.length>1500||/[\/\u0000-\u001f]/.test(sourceAttendanceId))throw Error('Open the exact original attendance row before approving straight duty.');
 const actualIn=instant(log.timeInAt),actualOut=instant(log.timeOutAt),hours=(actualOut-actualIn)/3600000;
 if(hours<=16||hours>18)throw Error('Straight-duty approval requires more than 16 and at most 18 actual recorded hours.');
 const basic=cents(log.dailyRate,{positive:true}),candidate=cents(log.candidateNightBonus??0),existing=cents(log.nightBonus??0),extraNight=Math.max(0,candidate-existing),holidayMultiplier=log.holidayMultiplier;
 if(![0,0.1,0.5].includes(holidayMultiplier))throw Error('Regenerate this payslip to confirm the saved work-date holiday rate.');
 let nightCoverage=null;
 if(extraNight){
  const row=log.candidateNightCoverage,start=attendanceMillis(row?.start),end=attendanceMillis(row?.end);
  if(!row||!['mid','night'].includes(row.shiftType)||typeof row.shiftId!=='string'||!row.shiftId||typeof row.revisionId!=='string'||!row.revisionId||!/^\d{4}-\d\d-\d\d$/.test(row.workDate||'')||!Number.isFinite(start)||!Number.isFinite(end)||start<actualIn||end>actualOut||end<=start||end-start>18*3600000)throw Error('The additional Mid/Night amount needs its saved dated shift reference.');
  nightCoverage={shiftId:row.shiftId,shiftType:row.shiftType,workDate:row.workDate,scheduleRevisionId:row.revisionId,expectedStartAt:new Date(start).toISOString(),expectedEndAt:new Date(end).toISOString()};
 }
 return {sourceAttendanceId,actualIn:new Date(actualIn).toISOString(),actualOut:new Date(actualOut).toISOString(),hours,extraBasicPay:basic/100,straightBonus:50,extraNightBonus:extraNight/100,holidayMultiplier,extraHolidayPay:Math.round((basic+extraNight)*holidayMultiplier)/100,nightCoverage};
}
function financialStamp(data,log){return JSON.stringify([data.name,data.staffId,data.branch,data.start,data.end,data.scheduleEvidenceStamp,data.basicPay,data.shiftsWorked,data.straightBonus,data.nightBonus,data.holidayPayTotal,data.straightDutyApprovals,log]);}

export function reviewStraightDuty(api,data,log,{onApproved}={}){
 let identity,facts,guard,token,stamp;
 const current=()=>{
  if(owner(api)!==identity||api.currentPayslipData!==data||api.globalPayrollCache?.[data?.name]!==data||data.isPaid||api.paidPayrollSnapshots?.has(data)||data.attendanceReviewRequired||data.salaryReviewRequired||!Array.isArray(data.logs)||!data.logs.includes(log)||data.logs.filter(row=>row.attendanceLogId===facts.sourceAttendanceId).length!==1||api.isBranchAllowed?.(data.branch)===false||api.isBranchAllowed?.(log.branch||data.branch)===false)throw Error('The selected unpaid payslip, attendance or Owner access changed. Reopen its current preview.');
  if(api.getPayrollPreviewGuard?.()!==guard)throw Error('Generate a fresh payroll list before reviewing straight duty.');
  guard.assertCurrent(token);
 };
 try{
  identity=owner(api);facts=rowFacts(log);guard=api.getPayrollPreviewGuard?.();if(!guard?.requireReady||!guard?.assertCurrent)throw Error('Generate a fresh payroll list before reviewing straight duty.');token=guard.requireReady();current();
  if(typeof onApproved!=='function')throw Error('Reload the Owner payslip before reviewing straight duty.');
 }catch(error){return Promise.reject(error);}
 let byData=states.get(api);if(!byData){byData=new WeakMap();states.set(api,byData);}let rows=byData.get(data);if(!rows){rows=new Map();byData.set(data,rows);}const prior=rows.get(facts.sourceAttendanceId);
 if(prior){if(prior.log!==log||prior.actualIn!==facts.actualIn||prior.actualOut!==facts.actualOut)return Promise.reject(Error('The reviewed attendance changed. Generate a fresh payroll list.'));return prior.promise;}
 const saved=log.straightDutyApproval||data.straightDutyApprovals?.find(row=>row.sourceAttendanceId===facts.sourceAttendanceId);
 if(saved){if(saved.version!==1||saved.actualIn!==facts.actualIn||saved.actualOut!==facts.actualOut||saved.reviewedByEmail!==OWNER_EMAIL)return Promise.reject(Error('The saved preview approval does not match this attendance. Generate the payroll list again.'));return Promise.resolve(saved);}
 if(log.straightApprovalRequired!==true||log.paidUnits!==1||Number(log.straightBonus||0)!==0)return Promise.reject(Error('This row is already included or does not need a straight-duty approval.'));
 stamp=financialStamp(data,log);const unchanged=()=>{current();if(financialStamp(data,log)!==stamp)throw Error('The payslip or attendance amounts changed. Review its current figures again.');};
 const entry={log,actualIn:facts.actualIn,actualOut:facts.actualOut};
 entry.promise=(async()=>{
  await assertPayrollScheduleFresh(api,data);unchanged();
  const Swal=api.Swal||globalThis.Swal;if(typeof Swal?.fire!=='function')throw Error('Reload the Owner app to review straight duty.');
  const total=facts.extraBasicPay+facts.straightBonus+facts.extraNightBonus+facts.extraHolidayPay;
  const result=await Swal.fire({title:'Approve straight duty for this payslip',html:'<p><strong>'+escape(data.name)+'</strong> · '+escape(log.branch||data.branch)+'</p><p>Actual Time In: '+escape(when(facts.actualIn))+'<br>Actual Time Out: '+escape(when(facts.actualOut))+'<br>Recorded work: <strong>'+facts.hours.toFixed(2)+' hours</strong></p><dl><dt>Additional daily pay</dt><dd>'+money(facts.extraBasicPay)+'</dd><dt>Straight-duty incentive</dt><dd>'+money(facts.straightBonus)+'</dd><dt>Additional Mid/Night bonus</dt><dd>'+money(facts.extraNightBonus)+'</dd><dt>Additional holiday pay</dt><dd>'+money(facts.extraHolidayPay)+'</dd><dt>Total addition to this unpaid preview</dt><dd><strong>'+money(total)+'</strong></dd></dl>',input:'textarea',inputLabel:'Owner approval reason',inputAttributes:{maxlength:'1500'},inputValidator:value=>String(value||'').trim().length<8||String(value||'').trim().length>1500?'Explain the approval in 8–1,500 characters.':undefined,showCancelButton:true,confirmButtonText:'Include in unpaid preview',footer:'These additions are saved when you confirm payroll.'});
  if(!result.isConfirmed)return null;unchanged();
  const reason=String(result.value||'').trim();if(reason.length<8||reason.length>1500)throw Error('Explain the straight-duty approval in 8–1,500 characters.');
  await assertPayrollScheduleFresh(api,data);unchanged();
  const {hours,...amounts}=facts,user=api.auth.currentUser;
  const audit=Object.freeze({version:1,...amounts,nightCoverage:amounts.nightCoverage?Object.freeze(amounts.nightCoverage):null,reviewedByUid:user.uid,reviewedByEmail:OWNER_EMAIL,reviewedAtISO:new Date().toISOString(),reason});entry.applied=true;
  await onApproved(audit);
  try{if(owner(api)===identity&&api.currentPayslipData===data)api.ManagerUI?.notify?.('Included in this unpaid payroll preview; saved with payroll confirmation');}catch{}
  return audit;
 })().finally(()=>{if(!entry.applied&&rows.get(facts.sourceAttendanceId)===entry)rows.delete(facts.sourceAttendanceId);});
 rows.set(facts.sourceAttendanceId,entry);return entry.promise;
}
