import {attendanceKind,attendanceMillis} from './attendance-reconcile.js';
import {documentState,validDocumentDay,philippineDocumentDay} from './staff-document-model.js';
const text=value=>String(value??'').trim();
const dayMs=86400000;
export function onboardingDay(value){
 if(typeof value==='boolean'||Array.isArray(value))return null;
 if(validDocumentDay(value))return value;
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const at=attendanceMillis(value);return Number.isFinite(at)?philippineDocumentDay(new Date(at)):null;
}
export function addCalendarMonths(value,months){
 if(!validDocumentDay(value)||!Number.isSafeInteger(months))throw Error('Choose a valid calendar date and month interval.');
 const [y,m,d]=value.split('-').map(Number),target=new Date(Date.UTC(y,m-1+months,1)),last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
 return new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth(),Math.min(d,last))).toISOString().slice(0,10);
}
export function addCalendarDays(value,days){if(!validDocumentDay(value)||!Number.isSafeInteger(days))throw Error('Choose a valid calendar date and day interval.');return new Date(Date.parse(value+'T00:00:00Z')+days*dayMs).toISOString().slice(0,10);}
export function initialContractDates(startDate){if(!validDocumentDay(startDate))throw Error('Confirm the employment start date before issuing the contract.');const endDate=addCalendarMonths(startDate,6);return {version:1,startDate,endDate,remindOn:addCalendarMonths(endDate,-1)};}
export function profileRequirements(profile={}){
 const fields=[['phone','Phone number',profile.phone],['address','Home address',profile.address],['emergencyName','Emergency contact name',profile.emergencyName],['emergencyNumber','Emergency contact phone',profile.emergencyNumber||profile.emergencyPhone||profile.emergencyContactNumber||profile.emergencyContact||profile.emergNum]];
 return fields.filter(([, ,value])=>!text(value)).map(([key,label])=>({key,label}));
}
export function firstWorkEvidence(staffId,attendance,{complete=false,today=new Date(),staffName=''}={}){
 const own=(Array.isArray(attendance)?attendance:[]).filter(row=>row.staffId===staffId&&attendanceKind(row)==='TIME IN'&&!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status));
 const legacy=(Array.isArray(attendance)?attendance:[]).filter(row=>!row.staffId&&text(row.staffName)===text(staffName)&&attendanceKind(row)==='TIME IN'&&!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status));
 const issues=[];if(!complete)issues.push('The complete first-work attendance history has not been confirmed with HQ.');
 const now=attendanceMillis(today),invalid=own.some(row=>!Number.isFinite(attendanceMillis(row.timestamp))||attendanceMillis(row.timestamp)>now+60000);
 if(invalid)issues.push('A first-work attendance timestamp needs HR review.');
 const ordered=own.filter(row=>row.id&&Number.isFinite(attendanceMillis(row.timestamp))&&attendanceMillis(row.timestamp)<=now+60000).sort((a,b)=>attendanceMillis(a.timestamp)-attendanceMillis(b.timestamp)||String(a.id).localeCompare(String(b.id)));
 if(!ordered.length)issues.push('No confirmed employee-ID Time In is available yet.');
 const earlierLegacy=legacy.some(row=>!Number.isFinite(attendanceMillis(row.timestamp))||!ordered.length||attendanceMillis(row.timestamp)<attendanceMillis(ordered[0].timestamp));
 if(earlierLegacy)issues.push('Earlier name-only attendance exists. HR must confirm the actual first workday before start-based deadlines can be calculated.');
 const renamedHistory=(Array.isArray(attendance)?attendance:[]).some(row=>row.staffId===staffId&&attendanceKind(row)&&!row.deleted&&!['Voided','Cancelled','Canceled','Deleted'].includes(row.status)&&Number.isFinite(attendanceMillis(row.timestamp))&&attendanceMillis(row.timestamp)<=now+60000&&text(row.staffName)&&text(row.staffName)!==text(staffName));
 if(renamedHistory)issues.push('Attendance contains a previous employee name. HR must confirm the actual first workday before start-based deadlines can be calculated.');
 const first=complete&&!invalid&&!earlierLegacy&&!renamedHistory?ordered[0]:null;
 return {date:first?onboardingDay(first.timestamp):null,attendanceId:first?.id||null,candidateDate:ordered[0]?onboardingDay(ordered[0].timestamp):null,candidateAttendanceId:ordered[0]?.id||null,issues,complete:complete&&!invalid};
}
const eventId=(staffId,kind,date)=>['onboarding-v1',staffId,kind,date||'unconfirmed'].map(encodeURIComponent).join(':');
export function validStartConfirmation(value,today=new Date()){
 return value?.version===1&&Number.isSafeInteger(value.revision)&&value.revision>0&&validDocumentDay(value.date)&&value.date<=onboardingDay(today)&&text(value.reason).length>=8&&value.confirmedBy==='jgo031996@gmail.com'&&text(value.confirmedByUid).length>0&&onboardingDay(value.confirmedAt)!==null&&typeof value.auditId==='string'&&/^[-A-Za-z0-9_]{1,340}$/.test(value.auditId)&&(value.sourceAttendanceId===null||typeof value.sourceAttendanceId==='string'&&value.sourceAttendanceId.length>0&&!value.sourceAttendanceId.includes('/'));
}
export function buildOnboardingState({staffId,profile={},attendance=[],attendanceComplete=false,documents={},documentsAvailable=false,today=new Date()}={}){
 if(typeof staffId!=='string'||!staffId||staffId.includes('/'))throw Error('Choose a saved employee account.');
 const todayDay=onboardingDay(today);if(!todayDay)throw Error('The current date could not be confirmed.');
 const hireDate=onboardingDay(profile.dateHired),first=firstWorkEvidence(staffId,attendance,{complete:attendanceComplete,today,staffName:profile.cashierName}),firstWorkDate=first.date,confirmation=validStartConfirmation(profile.onboardingStartConfirmation,today)?profile.onboardingStartConfirmation:null,startDate=confirmation?.date||firstWorkDate,startSource=confirmation?'HR-confirmed start':firstWorkDate?'First confirmed Time In':'Awaiting HR confirmation';
 // A system rollout or name change must not become an established employee's
 // new first day. A saved hire date is a reminder baseline, never a claim that
 // a first punch or signed employment term has been verified.
 const savedHireBaseline=hireDate&&hireDate<=todayDay?hireDate:null;
 const reminderUsesHire=!!savedHireBaseline&&(!firstWorkDate||savedHireBaseline<=firstWorkDate);
 const reminderStartDate=confirmation?.date||(reminderUsesHire?savedHireBaseline:firstWorkDate);
 const reminderStartSource=confirmation?'HR-confirmed start':reminderUsesHire?'Saved hire date':firstWorkDate?'First confirmed Time In':'Awaiting start date';
 const establishedStaff=!!reminderStartDate&&reminderStartDate<addCalendarDays(todayDay,-7);
 const historicalEvidenceIssue=reason=>/complete first-work attendance history|No confirmed employee-ID Time In|Earlier name-only attendance|previous employee name/.test(reason);
 const historicalEvidenceNote=reason=>/Earlier name-only attendance/.test(reason)?'Earlier name-only attendance is preserved. Reminders use the saved hire date; the actual first punch is unconfirmed.':/previous employee name/.test(reason)?'Attendance includes a previous employee name. Historical records are preserved; reminders use the saved hire date and the actual first punch is unconfirmed.':/No confirmed employee-ID Time In/.test(reason)?'No employee-ID first punch is confirmed in the available history. Reminders use the saved hire date.':'Historical attendance is not fully available. Reminders use the saved hire date; the actual first punch is unconfirmed.';
 const attendanceEvidenceNotes=!confirmation&&savedHireBaseline?first.issues.filter(historicalEvidenceIssue).map(historicalEvidenceNote):[];
 const reviewReasons=confirmation?[]:first.issues.filter(reason=>!savedHireBaseline||!historicalEvidenceIssue(reason));
 if(hireDate&&hireDate>todayDay&&!firstWorkDate){for(let i=reviewReasons.length-1;i>=0;i--)if(reviewReasons[i]==='No confirmed employee-ID Time In is available yet.')reviewReasons.splice(i,1);}
 if(profile.dateHired!==undefined&&profile.dateHired!==null&&profile.dateHired!==''&&!hireDate)reviewReasons.push('The saved hire date is invalid.');
 if(profile.onboardingStartConfirmation&&!confirmation)reviewReasons.push('The saved employment-start confirmation needs HR review.');
 if(!confirmation&&hireDate&&first.candidateDate&&first.candidateDate<hireDate)reviewReasons.push('A recorded employee-ID Time In is earlier than the saved hire date. HR must confirm the employment record.');
 const requirementsDueDate=reminderStartDate?addCalendarDays(reminderStartDate,7):null,profileMissing=profileRequirements(profile),validId=documentsAvailable?documentState('valid_id',documents?.valid_id,today):{code:'unavailable',label:'Private access needed',needsUpload:false,needsReview:false,complete:false};
 const requirementsComplete=profileMissing.length===0&&documentsAvailable&&!validId.needsUpload;
 const requirementsStatus=requirementsComplete?'complete':!requirementsDueDate?'start-unconfirmed':todayDay>requirementsDueDate?'overdue':todayDay===requirementsDueDate?'due-today':'pending';
 const status=text(profile.contractStatus),offerType=status==='Pending Initial Contract'?'Initial':status==='Pending Renewal'?'Extension':status==='Pending Regularization'?'Regularization':null;
 const termKey=['Pending Renewal','Extended'].includes(status)?'extension':['Pending Regularization','Regular'].includes(status)?'regularization':'initial';
 const savedTerm=profile.contractTerms?.[termKey],termValid=savedTerm?.version===1&&validDocumentDay(savedTerm.startDate)&&validDocumentDay(savedTerm.endDate)&&savedTerm.endDate>=savedTerm.startDate&&validDocumentDay(savedTerm.remindOn)&&savedTerm.remindOn<=savedTerm.endDate;
 const contractSigned=Boolean(profile.signedContracts?.[termKey]||savedTerm?.signedOn),regular=status==='Regular'||Boolean(profile.signedContracts?.regularization);
 const probationReviewDate=reminderStartDate?addCalendarMonths(reminderStartDate,6):null,probationReminderDate=probationReviewDate?addCalendarMonths(probationReviewDate,-1):null;
 const contractEndDate=termValid?savedTerm.endDate:null,contractReminderDate=termValid?savedTerm.remindOn:null;
 if(savedTerm&&!termValid)reviewReasons.push('The saved contract term dates need HR review.');
 if(contractSigned&&!termValid&&!regular)reviewReasons.push('This legacy signed contract has no confirmed stored term dates. Its signed document is preserved.');
 const contractReviewDate=contractEndDate||(!regular&&termKey==='initial'?probationReviewDate:null),reviewReminderDate=contractReminderDate||(!regular&&termKey==='initial'?probationReminderDate:null);
 const contractStage=regular?'regular-record':offerType?'offer-ready':!contractReviewDate?'dates-unconfirmed':todayDay>contractReviewDate?'review-overdue':todayDay===contractReviewDate?'review-today':todayDay>=reviewReminderDate?'review-due':'scheduled';
 const inactive=profile.active===false||profile.archived===true||/resigned|terminated|revoked|deleted|inactive/i.test(status+' '+text(profile.status))||/^(REVOKED|BLOCKED)$/i.test(text(profile.pin));
 const messages=[],name=text(profile.cashierName)||'team member';
 if(!inactive){
  if(!establishedStaff&&reminderStartDate&&reminderStartDate>=addCalendarDays(todayDay,-7))messages.push({id:eventId(staffId,'welcome',reminderStartDate),kind:'welcome',title:'Welcome to TAKODEÁL, '+name+'!',text:(confirmation?'Your HR-confirmed start date is ':reminderStartSource==='Saved hire date'?'Your saved hire date is ':'Your first recorded workday is ')+reminderStartDate+'. Thank you for being part of the team.',date:reminderStartDate,tone:'welcome'});
  else if(!startDate&&hireDate&&hireDate>=addCalendarDays(todayDay,-7))messages.push({id:eventId(staffId,'scheduled-welcome',hireDate),kind:'welcome',title:'Welcome to TAKODEÁL, '+name+'!',text:hireDate&&hireDate>todayDay?'Your saved start date is '+hireDate+'. Your first recorded Time In will confirm your workday.':'Your team profile is ready. HR still needs your first confirmed Time In before work-based dates can be calculated.',date:hireDate,tone:'welcome'});
  if(!requirementsComplete)messages.push({id:eventId(staffId,'requirements',requirementsDueDate),kind:'requirements',title:requirementsStatus==='overdue'?'Please complete your employee requirements':requirementsStatus==='due-today'?'Employee requirements are due today':'Finish your employee profile',text:(requirementsDueDate?'Please complete your personal/contact details and upload your Valid ID by '+requirementsDueDate+'.'+(reminderStartSource==='Saved hire date'?' This reminder uses your saved hire date.':''):'Complete your personal/contact details and Valid ID. The one-week due date starts from a saved hire date or confirmed work start.')+(documentsAvailable?'':' Use your approved Staff phone to check private ID records.'),date:requirementsDueDate,tone:['overdue','due-today'].includes(requirementsStatus)?'attention':'info'});
  if(offerType)messages.push({id:eventId(staffId,'contract-offer-'+termKey,savedTerm?.issuedAt?onboardingDay(savedTerm.issuedAt):contractEndDate||hireDate),kind:'contract-offer',title:'Your employment document is ready',text:'Management has issued an '+offerType.toLowerCase()+' document. Review the complete terms before choosing whether to sign.',date:contractEndDate,tone:'info'});
  if(['review-due','review-today','review-overdue'].includes(contractStage))messages.push({id:eventId(staffId,'contract-review-'+termKey,contractReviewDate),kind:'contract-review',title:contractEndDate?'Contract review reminder':'Six-month HR review reminder',text:(contractEndDate?'Your saved contract term ends on '+contractEndDate+'.':'Your six-month review date based on '+(reminderStartSource==='Saved hire date'?'your saved hire date':reminderStartSource==='HR-confirmed start'?'your HR-confirmed start':'your first confirmed Time In')+' is '+contractReviewDate+'. This is a review reminder; the legacy contract dates need HR confirmation.')+' Please coordinate with HQ. This reminder does not end, renew or change your employment, attendance or pay.',date:contractReviewDate,tone:'attention'});
  if(reviewReasons.length)messages.push({id:eventId(staffId,'hr-review',firstWorkDate||hireDate),kind:'hr-review',title:'Your employment dates need HR review',text:reviewReasons.join(' '),date:firstWorkDate||hireDate,tone:'info'});
 }
 return {version:1,staffId,name,today:todayDay,hireDate,firstWorkDate,firstAttendanceId:first.attendanceId,candidateFirstWorkDate:first.candidateDate,candidateFirstAttendanceId:first.candidateAttendanceId,startDate,startSource,reminderStartDate,reminderStartSource,establishedStaff,attendanceEvidenceNotes,hasStartConfirmation:!!confirmation,hireDateDifference:!!(hireDate&&startDate&&hireDate!==startDate),attendanceComplete:first.complete,requirementsDueDate,requirementsStatus,requirementsComplete,profileMissing,validId,documentsAvailable,probationReviewDate,probationReminderDate,contractEndDate,contractReminderDate,contractReviewDate,contractStage,contractSigned,offerType,termKey,regular,inactive,needsHRReview:reviewReasons.length>0,reviewReasons,messages};
}
