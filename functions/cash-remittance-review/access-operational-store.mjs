import {accessId,accessDevice,activeAccessStaff} from './access-model.mjs';
const NAMES=['cashierName','name','fullName','scheduleNickname','scheduleName','nickname'];
const ATTENDANCE=['staffId','staffName','branch','type','timestamp','status','deleted','isManual','source','timeInLogId','timeInAt','attendanceVersion','scheduleSnapshot','lateMinutes','originalLateMinutes','reviewedLateMinutes','lateExempted','lateReviewRequestId','lateDecision','lateReviewedAt','lateReviewedBy','lateReviewHistory','lateAmendmentReview','scheduleAmendmentReview','emergencyRelief','reliefRequestId','reliefScheduleReview','reviewedScheduleAmendmentId','penaltyAmount'];
const FIELDS={
 attendance_logs:ATTENDANCE,
 hr_sanctions:['staffId','staffName','branch','caseVersion','caseKey','caseNumber','status','finding','decisionRevision','reviewedByUid','reviewedByEmail','reviewReason','reviewedAt','reviewedAction','proposedSeverity','severity','effectiveDate','timestamp','issuedAt','scheduleVersion','scheduleRevision','reason','details','staffReply','repliedAt','replyByStaffId','replyScheduleRevision'],
 sop_logs:['staffId','staffName','branch','timestamp','timeInLogId','timeInAt','shiftStartedAt','type','status','deleted','tasks','checklist','role','roleName','scorePercentage','shift','shiftId','sopVersion','completion','completedAt','notes'],
 staff_requests:['staffId','staffName','branch','type','status','timestamp','amount','reason','item','items','totalValueLost','managerReply','managerReplyAt','respondedAt','respondedBy','approvedAt','approvedBy','rejectedAt','staffAcknowledged','staffAcknowledgedAt','proofImageUrl','explanationCause','explanationMessage','explanationPhoto','originalLateMinutes','lateMinutes','timeInLogId','timeInAt','attendanceLogId','linkedAttendanceId','proposedSchedule','savedShift','scheduleProposal','proposedShift','proposedStart','proposedEnd','proposedShiftStart','proposedShiftEnd','requestedAt','workDate','dateStr','startDate','endDate','leaveType','leaveDays','leaveVersion','requestVersion','changeVersion','leaveRequestId','originalRequestId','replacementRequestId','changeRequestId','leaveDecision','cancelledAt','cancellationReason','earlyTimeOut','requestedTimeOutAt','timeOutAt','earlyTimeOutVersion','ownerTimeOutApproval','mealLevelId','mealRole','mealIdentitySource','mealDay','saleId','receiptId','staffPinVerificationId','shiftDeclaration','proposedScheduleReview','scheduleReview','scheduleReviewStatus','scheduleReviewReason','scheduleReviewAt','scheduleReviewBy'],
 shift_swaps:['requesterName','requesterStaffId','requesterAssignedName','targetName','targetAssignedName','targetStaffId','branch','targetBranch','workDate','dateStr','dayIndex','sourceScheduleMonth','sourceRevisionId','requesterShiftId','requesterShiftName','targetShiftId','targetShiftName','requestVersion','status','timestamp','targetResponse','targetRespondedAt','targetRespondedBy','targetAcceptedAt','targetRejectedAt','managerReply','approvedAt','approvedBy','rejectedAt','hqReviewedAt','hqReviewedBy','cancelledAt'],
 acknowledgments:['announcementId','staffId','staffName','branch','signature','timestamp','acknowledgedAt','signedAt'],
 announcements:['title','subHeadline','message','footerMessage','images','timestamp','active','targetType','targetBranch','targetStaff','targetStaffId','requiresSignature','type']
};
FIELDS.staff_requests.push('schemaVersion','scheduledEndAt','scheduleFingerprint','requestToken','requiresScheduleReview','requestedDepartureAt','staffShiftProposal','scheduleDeclaration','pendingLeaveChangeId','leaveIntent','activeDates','sourceLeaveVersion','sourceActiveDates','requestedActiveDates','changeKind','cancelDates','proposedStartDate','proposedEndDate','leaveState','leaveScheduleSync','withdrawnAt','withdrawnByStaffId','timeOutLogId','actualTimeOutAt','consumedAt','emergencyRelief','emergencyReliefPriorRequest','declarationAcknowledgement');
FIELDS.announcements.push('isSchedule');
FIELDS.shift_swaps.push('acceptedByStaffId','acceptedBy','acceptedAt','acceptanceVersion','rejectedByStaffId','rejectedBy');
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const deny=()=>fail(403,'access/approval','This Staff account or device needs HQ confirmation.');
const review=()=>fail(409,'access/history-review','The saved operational history is incomplete or has an ambiguous identity. Ask HQ to review it; no new punch has been created.');
const stamp=value=>value?.toMillis?.()??(value instanceof Date?+value:Date.parse(value));
const revision=value=>value?String(value.seconds??value._seconds)+'|'+String(value.nanoseconds??value._nanoseconds):'';
const snapData=value=>value?.exists?value.data():null;
const safeName=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\u0000-\u001f\u007f]/.test(value);
function boundedValue(value,depth=0){
 if(depth>12)review();
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'){if(value.length>220000)review();return value;}
 if(value instanceof Date)return value;
 if(typeof value?.toDate==='function'&&Number.isSafeInteger(value.seconds)&&Number.isSafeInteger(value.nanoseconds))return{seconds:value.seconds,nanoseconds:value.nanoseconds};
 if(Array.isArray(value)){if(value.length>500)review();return value.map(item=>boundedValue(item,depth+1));}
 if(value&&typeof value==='object'){const entries=Object.entries(value);if(entries.length>150)review();return Object.fromEntries(entries.filter(([key])=>!/^(pin|securityPin|password|token|idToken|salary|dailyRate|monthlyRate|sss|philhealth|pagibig|bankAccount|governmentId)$/i.test(key)).map(([key,item])=>[key,boundedValue(item,depth+1)]));}
 review();
}
export function createAccessOperationalReader(db,{now=Date.now}={}){
 return async({uid,staffId,deviceId,app,sessionId,table,owner=false}={})=>{
  if(!accessId(uid)||!accessId(staffId)||!accessDevice(deviceId)||!['staff','cashier'].includes(app)||!Object.hasOwn(FIELDS,table))deny();
  return db.runTransaction(async tx=>{
   const read=async path=>snapData(await tx.get(db.doc(path)));
   const profileSnap=await tx.get(db.doc('cashiers/'+staffId)),profile=snapData(profileSnap);if(!activeAccessStaff(profile))deny();
   const session=await read('staff_login_sessions/'+uid),operatorSnap=accessId(session?.staffId)?session.staffId===staffId?profileSnap:await tx.get(db.doc('cashiers/'+session.staffId)):null,operatorProfile=snapData(operatorSnap);
   const operatorValid=session?.schemaVersion===1&&session.uid===uid&&session.deviceId===deviceId&&session.app===app&&accessId(sessionId)&&session.sessionId===sessionId&&Number.isFinite(stamp(session.expiresAt))&&stamp(session.expiresAt)>now()&&typeof session.profileRevision==='string'&&session.profileRevision!==''&&session.profileRevision===revision(operatorSnap?.updateTime)&&activeAccessStaff(operatorProfile),sessionValid=operatorValid&&session.staffId===staffId;
   let branch=profile.branch;
   if(app==='cashier'){
    if(owner===true){const mirrors=await tx.get(db.collection('pos_devices').where('deviceId','==',deviceId).limit(3));if(mirrors.docs.length!==1)deny();const mirror=mirrors.docs[0].data();if(mirror.status!=='Active'||String(mirror.appType||'').trim().toLowerCase()==='staff'||typeof mirror.branch!=='string'||!mirror.branch)deny();branch=mirror.branch;}
    else{const binding=await read('pos_bindings/'+uid);if(binding?.uid!==uid||binding.status!=='Active'||binding.deviceId!==deviceId||!accessId(binding.legacyDeviceDocId))deny();const mirror=await read('pos_devices/'+binding.legacyDeviceDocId);if(mirror?.status!=='Active'||mirror.deviceId!==deviceId||mirror.branch!==binding.branch||String(mirror.appType||'').trim().toLowerCase()==='staff')deny();branch=binding.branch;}
    if(sessionId!==undefined&&(!operatorValid||session.branch!==branch))deny();
    if(!sessionValid){const proof=await read('staff_pin_contexts/'+uid+'_time-clock');if(!['attendance_logs','sop_logs','announcements','staff_requests','hr_sanctions'].includes(table)||proof?.schemaVersion!==1||proof.uid!==uid||proof.staffId!==staffId||proof.deviceId!==deviceId||proof.app!=='cashier'||proof.branch!==branch||proof.purpose!=='time-clock'||!Number.isFinite(stamp(proof.expiresAt))||stamp(proof.expiresAt)<=now()||proof.profileRevision!==revision(profileSnap.updateTime)||proof.sessionId!=null&&(!operatorValid||proof.sessionId!==sessionId))deny();}
   }else{
    if(!sessionValid||session.branch!==profile.branch)deny();const binding=await read('staff_app_bindings/'+uid),config=await read('staff_app_setup_config/current');
    if(binding){
     if(config?.protocolVersion!==1||binding.status!=='Active'||binding.deviceId!==deviceId||binding.staffId!==staffId||binding.branch!==profile.branch)deny();
     const index=await read('staff_app_device_index/'+deviceId),mirror=await read('pos_devices/'+deviceId);
     if(index?.uid!==uid||index.staffId!==staffId||index.deviceId!==deviceId||mirror?.status!=='Active'||mirror.setupUid!==uid||mirror.staffId!==staffId||mirror.branch!==profile.branch||mirror.deviceId!==deviceId)deny();
    }else{
     if(config?.enabled===true)deny();const mirrors=await tx.get(db.collection('pos_devices').where('deviceId','==',deviceId).limit(3));
     if(mirrors.docs.length!==1)deny();const mirror=mirrors.docs[0].data();if(mirror.status!=='Active'||mirror.appType!=='Staff'||mirror.setupVersion||mirror.setupUid)deny();
    }
   }
   const aliases=[...new Set(NAMES.map(key=>profile[key]).concat(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[]).filter(safeName).flatMap(value=>[value,value.trim()]).filter(safeName))];if(!aliases.length||aliases.length>20)review();
   const uniqueCache=new Map();
   async function unique(name){
    if(uniqueCache.has(name))return uniqueCache.get(name);const ids=new Set();let capped=false;
    for(const field of [...NAMES,'scheduleAliases']){const snap=await tx.get(db.collection('cashiers').where(field,field==='scheduleAliases'?'array-contains':'==',name).limit(3).select('cashierName'));if(snap.docs.length>=3)capped=true;for(const row of snap.docs)ids.add(row.id);}
    const valid=!capped&&ids.size===1&&ids.has(staffId);uniqueCache.set(name,valid);return valid;
   }
   const metaFields=table==='announcements'?['active','targetType','targetBranch','targetStaff','targetStaffId','isPrivateMessage']:table==='shift_swaps'?['targetStaffId','targetName','targetAssignedName','status']:['staffId','staffName'];
   const searches=table==='announcements'?[['active','==',true]]:table==='shift_swaps'?[['targetStaffId','==',staffId],...aliases.flatMap(name=>[['targetName','==',name],['targetAssignedName','==',name]])]:[['staffId','==',staffId],...aliases.map(name=>['staffName','==',name])];
   const metadata=new Map();let readCount=0;
   for(const [field,operator,value]of searches){
    let cursor=null;
    for(let page=0;page<100;page++){
     let query=db.collection(table).where(field,operator,value).select(...metaFields).limit(50);if(cursor)query=query.startAfter(cursor);
     const snap=await tx.get(query);readCount+=snap.docs.length;if(readCount>20000)review();
     for(const row of snap.docs)metadata.set(row.id,row.data());if(metadata.size>5000)review();
     if(snap.docs.length<50)break;if(page===99)review();cursor=snap.docs.at(-1);
    }
   }
   const owned=[];
   for(const [id,row]of metadata){
    let allowed=false;
    if(table==='announcements'){
     if(row.active!==true)continue;
     const legacy=row.targetType==null||row.targetType==='',hasPerson=Boolean(row.targetStaffId||row.targetStaff),hasBranch=Boolean(row.targetBranch),personal=typeof row.targetStaffId==='string'&&row.targetStaffId?row.targetStaffId===staffId:aliases.includes(row.targetStaff)&&await unique(row.targetStaff);
     allowed=row.targetType==='All'&&row.isPrivateMessage!==true&&!hasPerson&&!hasBranch
       ||row.targetType==='Branch'&&row.targetBranch===branch&&!hasPerson&&row.isPrivateMessage!==true
       ||row.targetType==='Individual'&&personal&&(!hasBranch||row.targetBranch===branch)
       ||legacy&&(!hasPerson||personal)&&(!hasBranch||row.targetBranch===branch)&&(hasPerson||hasBranch||row.isPrivateMessage!==true);
    }else if(table==='shift_swaps'){
     if(!['Pending','Pending Staff Acceptance'].includes(row.status))continue;
     if(row.targetStaffId!=null&&row.targetStaffId!=='')allowed=row.targetStaffId===staffId;
     else {const names=[row.targetAssignedName,row.targetName].filter(safeName);allowed=names.length>0&&names.every(name=>aliases.includes(name));for(const name of names)if(!await unique(name))allowed=false;}
    }else{
     if(row.staffId!=null&&row.staffId!=='')allowed=row.staffId===staffId;
     else if(aliases.includes(row.staffName)){if(!await unique(row.staffName))review();allowed=true;}
    }
    if(allowed)owned.push(id);
   }
   const records=[];let bytes=0;
   for(const id of owned){
    const [snapshot]=await tx.getAll(db.doc(table+'/'+id),{fieldMask:FIELDS[table]});if(!snapshot.exists)review();
    const record={id,...Object.fromEntries(Object.entries(snapshot.data()).filter(([key])=>FIELDS[table].includes(key)).map(([key,value])=>[key,boundedValue(value)]))};
    const size=Buffer.byteLength(JSON.stringify(record));bytes+=size;if(size>256000||bytes>6*1024*1024)review();records.push(record);
   }
   return{schemaVersion:1,staffId,table,asOf:new Date(now()).toISOString(),complete:true,records};
  });
 };
}
