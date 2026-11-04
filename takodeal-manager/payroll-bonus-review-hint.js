import {OWNER_EMAIL,canOpenWorkspacePage} from './workspace-access-model.js';
import {nightRate} from './payroll-safety.js';
import {attendanceMillis} from './attendance-reconcile.js';
import {scheduleDateKey} from './schedule-history.js';

const id=value=>typeof value==='string'&&value.trim()&&value.length<=1500&&!/[\/\u0000-\u001f]/.test(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function owner(api){
 const user=api?.auth?.currentUser,session=api?.sessionUser;
 return !!(user?.uid&&user.email?.toLowerCase()===OWNER_EMAIL&&user.emailVerified===true&&user.providerData?.some(row=>row.providerId==='google.com')&&session?.uid===user.uid&&session.email?.toLowerCase()===OWNER_EMAIL&&session.isOwner===true&&session.isFranchisee!==true&&canOpenWorkspacePage(session,'payroll'));
}
function instant(value){
 if(value==null||typeof value==='boolean'||typeof value==='number'||typeof value==='string'&&(!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!day(value.slice(0,10))))return NaN;
 return attendanceMillis(value);
}

// A nonblocking comparison of preserved reference hours and actual punches.
// It neither classifies the actual shift nor awards a bonus from clock time.
export function payrollBonusReviewHint(api,data,log){
 if(!owner(api)||!data||data.isPaid||api.paidPayrollSnapshots?.has(data)||typeof log?.nightBonus!=='number'||log.nightBonus!==0)return null;
 const staffId=data.staffId||data.profile?.staffId||data.profile?.id,branch=log.branch||data.branch;
 if(!id(staffId)||!id(log.attendanceLogId)||!branch||api.isBranchAllowed?.(branch)===false)return null;
 const configuredBonus=nightRate(data.profile||{});if(!(configuredBonus>0))return null;
 const actualIn=instant(log.timeInAt),actualOut=instant(log.timeOutAt),expectedIn=instant(log.expectedStartAt),expectedOut=instant(log.expectedEndAt),actualHours=(actualOut-actualIn)/3600000,savedHours=(expectedOut-expectedIn)/3600000;
 if(![actualIn,actualOut,expectedIn,expectedOut].every(Number.isFinite)||actualHours<8||actualHours>18||savedHours<1||savedHours>18||Math.abs(actualIn-expectedIn)>24*3600000)return null;
 const overlap=Math.max(0,Math.min(actualOut,expectedOut)-Math.max(actualIn,expectedIn)),offset=Math.abs(actualIn-expectedIn);
 if(offset<3*3600000||overlap>=Math.min(actualOut-actualIn,expectedOut-expectedIn)*0.5)return null;
 const expectedDay=scheduleDateKey(new Date(expectedIn)),workDate=day(log.rateWorkDate)&&log.rateWorkDate===expectedDay?log.rateWorkDate:expectedDay;
 return {blocking:false,actionLabel:'Review assigned shift',message:'Most recorded hours fall outside the saved shift reference. The saved work-date assignment may need Owner correction; review the original Time In to confirm Mid/Night eligibility.',actualHours,configuredBonus,
  actualIn:new Date(actualIn).toISOString(),actualOut:new Date(actualOut).toISOString(),expectedStartAt:new Date(expectedIn).toISOString(),expectedEndAt:new Date(expectedOut).toISOString(),
  context:{staffId,staffName:data.name,branch,workDate,from:data.start,to:data.end,attendanceLogId:log.attendanceLogId,attendanceLogIds:[log.attendanceLogId]}};
}
export function payrollBonusReviewHintHTML(hint){
 return hint?'<p class="payroll-bonus-review-hint" style="margin:6px 0;color:#92400e;font-size:12px"><strong>Assigned shift check</strong><br>'+escape(hint.message)+'</p>':'';
}
export function openPayrollBonusReviewHint(api,data,log){
 const hint=payrollBonusReviewHint(api,data,log);if(!hint)return false;
 if(api.currentPayslipData!==data||api.globalPayrollCache?.[data.name]!==data||typeof api.requirePayrollPreview!=='function')throw Error('Generate this unpaid payroll again and reopen the employee before reviewing its shift.');
 api.requirePayrollPreview(data);
 if(typeof api.openAttendanceRecovery==='function')return api.openAttendanceRecovery(hint.context);
 if(typeof api.openScheduleRecovery==='function')return api.openScheduleRecovery(hint.context);
 throw Error('Open HR review for this original Time In and its saved workday schedule.');
}
