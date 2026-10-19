// Daily wages are stored in the legacy hourlyRate field. Divide by eight only
// when calculating an hourly deduction; never multiply the stored rate by eight.
export function dailyStaffRate(profile){
 const value=profile?.hourlyRate??profile?.dailyRate;
 if(value==null||String(value).trim()===''||!['number','string'].includes(typeof value)||typeof value==='string'&&!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))return null;
 const rate=Number(value);return Number.isFinite(rate)&&rate>=0?rate:null;
}
export function validRateDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function staffRateDate(value=new Date()){
 if(validRateDate(value))return value;
 const date=value?.toDate?.()??(value?.seconds!=null?new Date(value.seconds*1000):new Date(value));
 if(!Number.isFinite(+date))throw Error('A valid Philippine work date is required for salary.');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(part=>[part.type,part.value]));
 return parts.year+'-'+parts.month+'-'+parts.day;
}
export function validateSalaryTimeline(value){
 if(value?.version!==1||!Number.isSafeInteger(value.revision)||value.revision<1||!value.rates||Array.isArray(value.rates)||typeof value.rates!=='object'||Object.keys(value.rates).length>500)throw Error('Salary history needs HQ review.');
 if(value.baselineDailyRate!==null&&dailyStaffRate({hourlyRate:value.baselineDailyRate})===null)throw Error('The prior salary baseline needs HQ review.');
 for(const [id,row] of Object.entries(value.rates))if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!validRateDate(row?.effectiveDate)||dailyStaffRate({hourlyRate:row?.dailyRate})===null||!Number.isSafeInteger(row.sequence)||row.sequence<1||row.sequence>value.revision)throw Error('A dated salary entry needs HQ review.');
 return value;
}
export function staffRateForDate(profile,date=new Date()){
 const key=staffRateDate(date);
 if(profile?.salaryRateVersion!==1)return dailyStaffRate(profile);
 const timeline=validateSalaryTimeline(profile.salaryRateTimeline);
 const events=Object.entries(timeline.rates).filter(([,row])=>row.effectiveDate<=key).sort((a,b)=>a[1].effectiveDate.localeCompare(b[1].effectiveDate)||a[1].sequence-b[1].sequence);
 return events.length?Number(events.at(-1)[1].dailyRate):timeline.baselineDailyRate;
}
export function staffRateWorkDate(log,shift){
 const expected=shift?.expectedStartAt??(!log?.scheduleSnapshot?.needsScheduleReview?log?.scheduleSnapshot?.expectedStartAt:null);
 return staffRateDate(expected||log?.timestamp||log);
}
export function staffProfileForWork(profile,log,shift){
 const workDate=staffRateWorkDate(log,shift),rate=staffRateForDate(profile,workDate);
 if(rate===null&&profile?.salaryRateVersion===1)throw Error('No daily wage is recorded for '+workDate+'. Ask HQ to review salary history.');
 return {...profile,hourlyRate:rate??0,salaryWorkDate:workDate};
}
export async function loadStaffSalaryTimeline(api,profile,{read}={}){
 if(profile?.salaryRateVersion!==1)return profile;
 const id=profile.staffId||profile.id;if(!id)throw Error('Reopen the employee before loading salary history.');
 const snap=await (read||api.getDocFromServer)(api.doc(api.db,'staff_salary_rates',id));
 if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Private salary history could not be confirmed. Reconnect using an approved account or Staff phone.');
 const timeline=validateSalaryTimeline(snap.data());
 if(timeline.staffId!==id||timeline.branch!==profile.branch)throw Error('Salary history does not match this employee and branch.');
 return {...profile,salaryRateTimeline:timeline};
}
export function payrollSalaryProfile(profile,date){
 const {salaryRateTimeline,...safe}=profile||{};
 return {...safe,hourlyRate:staffRateForDate(profile,date)??0};
}
export async function assertPayrollSalaryFresh(api,data){
 if(data?.isPaid)return;
 const id=data?.staffId||data?.profile?.staffId||data?.profile?.id;
 if(!id)throw Error('Reopen this employee’s unpaid payslip before payment.');
 const snap=await api.getDocFromServer(api.doc(api.db,'cashiers',id));
 if(!snap.exists()||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('Salary could not be confirmed. Reconnect and generate the unpaid payslip again before payment.');
 const live=snap.data(),preview=data.profile||{},dated=preview.salaryRateVersion===1;
 if(dated ? live.salaryRateVersion!==1||live.salaryRateRevision!==preview.salaryRateRevision
   : live.salaryRateVersion===1||dailyStaffRate(live)!==dailyStaffRate(preview))throw Error('Salary dates changed after this payroll preview. Generate the unpaid payslip again before payment.');
}
