import {resolveScheduleForDate,scheduleDateKey} from './schedule-history.js';
import {attendanceKind,attendanceMillis,linkedAttendanceHistory} from './attendance-reconcile.js';
import {emergencyShiftSourceFingerprint} from './emergency-shift-model.js';
import {activeLeaveDates,leaveNameKey,leavePerson} from './leave-model.js';
import {suspensionDates} from './sanction-schedule.js';
import {activeStaffProfile} from './staff-lifecycle-model.js';
import {OWNER_EMAIL} from './workspace-access-model.js';

const DAY=86400000,MINUTE=60000;
const copy=value=>JSON.parse(JSON.stringify(value));
const present=row=>row&&!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status);
const empty=value=>value==null||['','N/A','UNFILLED','STANDBY','-'].includes(String(value).trim());
export const workedShiftValidId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(value);
export function workedShiftCanonical(value){
    const normalize=item=>item instanceof Date||typeof item?.toDate==='function'||typeof item?.toMillis==='function'||item&&Number.isFinite(item.seconds)
        ?{at:attendanceMillis(item)}:Array.isArray(item)?item.map(normalize):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().filter(key=>item[key]!==undefined).map(key=>[key,normalize(item[key])])):item??null;
    return JSON.stringify(normalize(value));
}
export function workedShiftAttendanceEvidence(row){
    return Object.fromEntries(['id','staffId','staffName','branch','type','timestamp','timeInLogId','timeInAt','status','deleted','scheduleSnapshot','lateMinutes','reviewedLateMinutes','lateExempted','lateDecision','lateReviewRequestId','lateReviewedAt','lateReviewedBy','reliefScheduleReview','scheduleAmendmentReview'].filter(key=>row?.[key]!==undefined).map(key=>[key,row[key]]));
}
const time=value=>{const match=typeof value==='string'&&value.trim().match(/^(\d{1,2}):(\d{2})$/);return match&&+match[1]<24&&+match[2]<60?+match[1]*60+ +match[2]:null;};
const kind=rule=>['morning','mid','night','other'].includes(rule.shiftType)?rule.shiftType:/\bnight\b/i.test(rule.name||'')||/^n\d/i.test(rule.id)?'night':/\bmid(?:shift|-shift)?\b/i.test(rule.name||'')||/^mid/i.test(rule.id)?'mid':/\bmorning\b/i.test(rule.name||'')||/^m\d/i.test(rule.id)?'morning':'other';
function identity(profile,start){
    if(!activeStaffProfile(profile))throw Error('The active staff profile must be confirmed before changing this roster.');
    const person=leavePerson(profile,start.staffId),aliases=new Set([...person.aliases,start.staffName].map(leaveNameKey));
    return {...person,aliases:[...new Set([...person.aliases,start.staffName])],matches:value=>aliases.has(leaveNameKey(value))};
}
export function workedShiftPair(records,start){
    if(!present(start)||attendanceKind(start)!=='TIME IN'||!workedShiftValidId(start.id)||!workedShiftValidId(start.staffId)||typeof start.branch!=='string'||!start.branch.trim()||start.branch.length>120||!start.staffName)throw Error('Select the original saved Time In with its stable employee and branch.');
    const own=records.filter(row=>row.staffId===start.staffId||!row.staffId&&leaveNameKey(row.staffName)===leaveNameKey(start.staffName));
    const closures=records.filter(row=>present(row)&&row.timeInLogId===start.id);
    if(closures.length>1)throw Error('More than one Time Out links to this Time In. Review the exact records first.');
    const history=linkedAttendanceHistory(own,start.staffId,start.staffName),paired=history.filter(pair=>pair.in?.id===start.id),out=closures[0]||paired[0]?.out;
    const begin=attendanceMillis(start.timestamp),finish=attendanceMillis(out?.timestamp),hours=(finish-begin)/3600000;
    if(paired.length!==1||!out||!present(out)||attendanceKind(out)!=='TIME OUT'||String(out.type).toUpperCase().includes('AUTO')||out.staffId&&out.staffId!==start.staffId||out.branch!==start.branch||!Number.isFinite(hours)||hours<1||hours>18||out.timeInAt!=null&&attendanceMillis(out.timeInAt)!==begin)throw Error('A complete, unambiguous actual Time In and Time Out is required. Automatic Time Out or a sub-hour misclick cannot establish worked hours here.');
    if(own.some(row=>present(row)&&attendanceKind(row)==='TIME IN'&&row.id!==start.id&&attendanceMillis(row.timestamp)>=begin&&attendanceMillis(row.timestamp)<finish))throw Error('Another Time In overlaps these worked hours. Review that exact record first.');
    if(history.some(pair=>pair.in?.id!==start.id&&present(pair.in)&&(!pair.out?attendanceMillis(pair.in.timestamp)<begin&&begin-attendanceMillis(pair.in.timestamp)<18*3600000:present(pair.out)&&Math.max(begin,attendanceMillis(pair.in.timestamp))<Math.min(finish,attendanceMillis(pair.out.timestamp)))))throw Error('Another saved duty overlaps these worked hours. Review the exact records first.');
    return {start,out,hours,timeInAt:new Date(begin).toISOString(),timeOutAt:new Date(finish).toISOString()};
}
function keptLateness(start,matched){
    const amount=matched?.reliefReviewVerified||matched?.amendmentReviewVerified?matched.lateMinutes:start.reviewedLateMinutes??start.lateMinutes??matched?.lateMinutes??0;
    const exempt=matched?.reliefReviewVerified?matched.reliefLateExempted===true:matched?.amendmentReviewVerified?matched.amendmentLateExempted===true:start.lateExempted===true;
    if(!Number.isSafeInteger(amount)||amount<0||amount>1080)throw Error('The existing lateness decision needs review before this roster correction.');
    return {choice:'Keep saved lateness decision',lateMinutes:amount,exempt,original:{lateMinutes:start.lateMinutes??null,reviewedLateMinutes:start.reviewedLateMinutes??null,lateExempted:start.lateExempted===true,lateDecision:start.lateDecision??null,lateReviewRequestId:start.lateReviewRequestId??null}};
}
export function planWorkedShiftCorrection({start,out,profile,history,attendance=[],leaves=[],sanctions=[],payroll=[],claims=null,matchedShift,context={},now=new Date()}={}){
    const person=identity(profile,start),pair=workedShiftPair(attendance,start);
    if(pair.out.id!==out.id||workedShiftCanonical(workedShiftAttendanceEvidence(pair.out))!==workedShiftCanonical(workedShiftAttendanceEvidence(out)))throw Error('The saved Time Out changed. Reopen this worked shift.');
    const actual=attendanceMillis(start.timestamp),finish=attendanceMillis(out.timestamp),today=scheduleDateKey(now),midnight=Date.parse(scheduleDateKey(new Date(actual))+'T00:00:00+08:00'),choices=[],blockers=[];
    if(actual>+now||finish>+now)throw Error('The saved actual attendance is in the future. Confirm the source clock before correcting its roster.');
    const preservedLateness=keptLateness(start,matchedShift),samePerson=row=>row.staffId?row.staffId===person.staffId:person.matches(row.staffName);
    for(const offset of [-1,0,1]){
        const dayStart=midnight+offset*DAY,workDate=scheduleDateKey(new Date(dayStart));
        if(context.workDate&&context.workDate!==workDate||workDate>today)continue;
        const basis=resolveScheduleForDate(history,workDate),rules=basis?.branchConfig?.[start.branch];
        if(!basis?.scheduleRevisionId||!Array.isArray(rules))continue;
        const day=Number(workDate.slice(-2)),dayBranches=basis.currentSchedule?.[day],branch=dayBranches?.[start.branch];
        if(!branch||!branch.scheduled||typeof branch.scheduled!=='object'||Array.isArray(branch.scheduled))continue;
        const ids=new Set(),duplicate=new Set();for(const rule of rules){if(ids.has(rule?.id))duplicate.add(rule.id);ids.add(rule?.id);}
        if(rules.some(rule=>rule?.active!==false&&(!rule||!workedShiftValidId(rule.id)||duplicate.has(rule.id)||rule.active!==undefined&&rule.active!==true||rule.name!==undefined&&typeof rule.name!=='string'||rule.shiftType!==undefined&&!['morning','mid','night','other'].includes(rule.shiftType)||rule.days!==undefined&&(!Array.isArray(rule.days)||rule.days.some(day=>!Number.isInteger(day)||day<0||day>6))||time(rule.startTime)==null||time(rule.endTime)==null||(time(rule.endTime)-time(rule.startTime)+1440)%1440<60||(time(rule.endTime)-time(rule.startTime)+1440)%1440>1080))){blockers.push('Saved shift windows are incomplete or conflicting for '+workDate+'.');continue;}
        for(const rule of rules){
            const begin=time(rule?.startTime),end=time(rule?.endTime),duration=begin==null||end==null?0:(end-begin+1440)%1440;
            if(!workedShiftValidId(rule?.id)||duplicate.has(rule.id)||rule.active===false||rule.active!==undefined&&rule.active!==true||duration<60||duration>1080||Array.isArray(rule.days)&&!rule.days.includes(new Date(workDate+'T00:00:00Z').getUTCDay()))continue;
            const expectedStartAt=dayStart+begin*MINUTE,expectedEndAt=expectedStartAt+duration*MINUTE,overlap=Math.max(0,Math.min(finish,expectedEndAt)-Math.max(actual,expectedStartAt));
            if(overlap<=0)continue;
            const issues=[],occupant=branch.scheduled[rule.id],previousShiftIds=Object.entries(branch.scheduled).filter(([,name])=>person.matches(name)).map(([id])=>id);
            if(overlap<=(finish-actual)/2)issues.push('This saved window does not cover a majority of the actual worked hours.');
            if(!empty(occupant)&&!person.matches(occupant))issues.push('This saved slot belongs to another employee. A staff swap cannot be applied automatically.');
            for(const [otherBranch,roster]of Object.entries(dayBranches||{})){
                if(otherBranch!==start.branch&&Object.values(roster?.scheduled||{}).some(person.matches))issues.push('This employee also has an assignment at '+otherBranch+' on this work date.');
                if((roster?.unavailable||[]).some(row=>person.matches(typeof row==='string'?row:row?.name)))issues.push('This date has a saved unavailable, leave or suspension marker.');
            }
            if(Object.keys(basis.unavailability?.[workDate]||{}).some(person.matches))issues.push('This date has a saved availability restriction.');
            if(claims?.dates?.[workDate])issues.push('An approved leave owns this date. Review that leave separately.');
            for(const row of leaves.filter(row=>samePerson(row)&&row.type==='Leave'&&row.status==='Approved')){try{if(activeLeaveDates(row).includes(workDate))issues.push('An approved leave covers this date.');}catch{issues.push('A saved leave has invalid dates and needs review.');}}
            for(const row of sanctions.filter(samePerson)){try{if(suspensionDates(row).includes(workDate))issues.push('A reviewed suspension covers this date.');}catch{issues.push('A saved suspension needs review.');}}
            if(payroll.some(row=>samePerson(row)&&(row.frozenData||row.isPaid===true||Number.isFinite(row.finalNetPay))&&row.startDate<=workDate&&row.endDate>=workDate))issues.push('A paid payslip covers this work date. Its figures stay frozen.');
            const separate=linkedAttendanceHistory(attendance,person.staffId,start.staffName).filter(item=>item.in?.id!==start.id&&item.out&&present(item.in)&&present(item.out));
            if(previousShiftIds.some(id=>id!==rule.id)&&separate.some(item=>scheduleDateKey(new Date(attendanceMillis(item.in.timestamp)))===workDate))issues.push('Another completed duty exists on this date. Its plotted assignment must be reviewed separately.');
            const key=JSON.stringify([workDate,basis.scheduleRevisionId,rule.id]);
            const alreadyAssigned=previousShiftIds.length===1&&previousShiftIds[0]===rule.id,marker=basis.workedShiftCorrections?.[start.id],authorized=history.historyMonths?.[workDate.slice(0,7)]?.revisions?.find(row=>row.revisionId===marker?.correctionId);
            const alreadyCorrected=alreadyAssigned&&marker?.version===1&&marker.staffId===start.staffId&&marker.staffName===start.staffName&&marker.branch===start.branch&&marker.workDate===workDate&&marker.timeInLogId===start.id&&marker.timeOutLogId===out.id&&marker.timeInAt===pair.timeInAt&&marker.timeOutAt===pair.timeOutAt&&marker.sourceFingerprint===emergencyShiftSourceFingerprint(start)&&marker.shiftId===rule.id&&marker.expectedStartAt===new Date(expectedStartAt).toISOString()&&marker.expectedEndAt===new Date(expectedEndAt).toISOString()&&marker.shiftType===kind(rule)&&marker.reviewedByEmail===OWNER_EMAIL&&authorized?.source==='owner-worked-shift'&&workedShiftCanonical(authorized.historicalWorkedShiftReview)===workedShiftCanonical(marker);
            choices.push({key,shiftId:rule.id,shiftName:String(rule.name||rule.id).slice(0,160),shiftType:kind(rule),workDate,expectedStartAt:new Date(expectedStartAt).toISOString(),expectedEndAt:new Date(expectedEndAt).toISOString(),sourceRevisionId:basis.scheduleRevisionId,overlapHours:overlap/3600000,overlapRatio:overlap/(finish-actual),blockers:[...new Set(issues)],alreadyAssigned,alreadyCorrected:!!alreadyCorrected,existingCorrectionId:alreadyCorrected?marker.correctionId:null,previousShiftIds,basis});
        }
    }
    choices.sort((a,b)=>b.overlapHours-a.overlapHours||a.expectedStartAt.localeCompare(b.expectedStartAt)||a.shiftId.localeCompare(b.shiftId));
    if(!choices.length)blockers.push('No saved dated roster and shift window could be confirmed for this actual work date. Current templates were not copied into past history.');
    const meaningful=choices.filter(row=>row.overlapRatio>0.5),best=meaningful[0],winners=meaningful.filter(row=>row.overlapHours===best?.overlapHours),recommendedKey=winners.length===1&&!best.blockers.length?best.key:null;
    return {staffId:person.staffId,staffName:start.staffName,branch:start.branch,attendanceLogId:start.id,timeOutLogId:out.id,timeInAt:pair.timeInAt,timeOutAt:pair.timeOutAt,workedHours:pair.hours,sourceFingerprint:emergencyShiftSourceFingerprint(start),preservedLateness,choices,recommendedKey,blockers,person};
}
export function createWorkedShiftRevision(plan,choiceKey,{operationId,actor,at,index,cutover}={}){
    if(!workedShiftValidId(operationId)||operationId.length>80||!actor?.uid||actor.email!==OWNER_EMAIL)throw Error('Reopen the exact worked-shift correction.');
    const choice=plan.choices.find(row=>row.key===choiceKey);if(!choice||plan.blockers.length||choice.blockers.length)throw Error(choice?.blockers[0]||plan.blockers[0]||'Choose one of the saved dated shift slots.');
    if(choice.basis?.scheduleRevisionId!==choice.sourceRevisionId||choice.basis?.snapshotDate!==choice.workDate||typeof plan.sourceFingerprint!=='string'||!plan.sourceFingerprint||plan.sourceFingerprint.length>30000)throw Error('The original dated correction source is incomplete.');
    const revisionId='worked-'+operationId,day=Number(choice.workDate.slice(-2)),basis=choice.basis,fields=['branchConfig','employees','unavailability','currentYear','currentMonth','holidays','workedShiftCorrections'];
    const snapshot=Object.fromEntries(fields.filter(key=>basis[key]!==undefined).map(key=>[key,copy(basis[key])]));snapshot.currentSchedule={[day]:copy(basis.currentSchedule[day])};
    const roster=snapshot.currentSchedule[day][plan.branch],name=choice.previousShiftIds.map(id=>roster.scheduled[id]).find(value=>!empty(value))||plan.person.name;
    for(const id of choice.previousShiftIds)if(id!==choice.shiftId){roster.scheduled[id]='UNFILLED';if(roster.swaps)delete roster.swaps[id];}
    roster.scheduled[choice.shiftId]=name;roster.rest=(roster.rest||[]).filter(value=>!plan.person.matches(value));if(roster.swaps)delete roster.swaps[choice.shiftId];
    const marker={version:1,correctionId:revisionId,operationId,staffId:plan.staffId,staffName:plan.staffName,branch:plan.branch,workDate:choice.workDate,timeInLogId:plan.attendanceLogId,timeInAt:plan.timeInAt,timeOutLogId:plan.timeOutLogId,timeOutAt:plan.timeOutAt,sourceFingerprint:plan.sourceFingerprint,sourceRevisionId:choice.sourceRevisionId,shiftId:choice.shiftId,shiftName:choice.shiftName,shiftType:choice.shiftType,expectedStartAt:choice.expectedStartAt,expectedEndAt:choice.expectedEndAt,previousShiftIds:[...choice.previousShiftIds],preservedLateness:copy(plan.preservedLateness),reviewedByUid:actor.uid,reviewedByEmail:actor.email,reviewedAt:new Date(at).toISOString(),reason:'Owner applied the saved worked shift to this work date.'};
    snapshot.workedShiftCorrections={...(snapshot.workedShiftCorrections||{}),[plan.attendanceLogId]:marker};
    const revision={schemaVersion:1,kind:'schedule-revision',revisionId,month:choice.workDate.slice(0,7),effectiveFrom:choice.workDate,effectiveTo:choice.workDate,savedAt:marker.reviewedAt,actor:actor.email,source:'owner-worked-shift',payrollHistoryEnforcedFrom:cutover||choice.workDate,snapshot,daySnapshots:{[choice.workDate]:{configRevisionId:revisionId,daySchedule:copy(snapshot.currentSchedule[day])}},historicalWorkedShiftReview:copy(marker),sequence:(index?.revisionIds?.length||0)+1};
    if(new TextEncoder().encode(JSON.stringify(revision)).length>950000)throw Error('This dated correction is too large to save safely.');
    return revision;
}
export const workedShiftSourceFingerprint=emergencyShiftSourceFingerprint;
