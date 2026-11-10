import {normalizeStaffPayslip} from './payroll-view-core/staff-payslip-snapshot.js';
import {activeAccessStaff,accessId} from './access-model.mjs';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
const text=value=>typeof value==='string'?value.trim():'';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const denied=()=>fail(403,'access/approval','Use your personally approved private Staff phone to read saved payroll.');
const review=()=>fail(409,'access/payroll-review','The saved payroll identity needs HQ confirmation. No figures have been estimated.');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const privatePayrollFingerprint=record=>createHash('sha256').update(JSON.stringify(canonical(record))).digest('hex');
const aliasesOf=profile=>[...new Set(['cashierName','fullName','name','scheduleNickname','scheduleName','nickname'].flatMap(key=>typeof profile[key]==='string'&&text(profile[key])?[profile[key],text(profile[key])]:[]).concat(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases.flatMap(value=>typeof value==='string'&&text(value)?[value,text(value)]:[]):[]))];
const primitive=value=>value===null||['string','boolean'].includes(typeof value)||typeof value==='number'&&Number.isFinite(value);
const iso=value=>value?.toDate?value.toDate().toISOString():value instanceof Date?value.toISOString():value&&typeof value==='object'&&Number.isSafeInteger(value.seconds)&&Object.keys(value).every(key=>['seconds','nanoseconds','type'].includes(key))&&Number.isSafeInteger(value.nanoseconds??0)&&(value.nanoseconds??0)>=0&&(value.nanoseconds??0)<1000000000?new Date(value.seconds*1000+Math.floor((value.nanoseconds??0)/1000000)).toISOString():value;
const pick=(row,fields)=>Object.fromEntries(fields.filter(key=>row?.[key]!==undefined).map(key=>{const value=iso(row[key]);if(!primitive(value))throw Error('A saved payroll display value is invalid.');return[key,value];}));
const amountFields=['basicPay','nightBonus','overtime','nightBonusTotal','straightBonus','straightDutyBonusTotal','holidayPayTotal','holiday','perfBonus','performanceBonus','payrollAdjustments','lateDeduction','sss','philhealth','pagibig','advances','meals','loans','onlineRefunds','cashShortages','ownerDeductions','customDeductionsTotal','grossPay','totalDeductions','finalNetPay'];
const profileFields=['staffId','id','cashierName','name','branch','role','dateHired','hourlyRate','dailyRate','salaryRateVersion','salaryRateRevision','eligibleNightDiff','nightDiffRate'];
const logFields=['date','dateString','in','out','hrs','remark','branch','attendanceLogId','timeInAt','timeOutAt','expectedStartAt','expectedEndAt','scheduleSource','scheduleRevisionId','lateMins','rateWorkDate','dailyRate','nightBonus','bonusBasis','bonusReviewReason'];
const detailFields=['id','staffId','bucket','type','amount','label','category','incidentDate','effectiveDate','dateAdded','sourcePlatform','sourceReceiptId','sourceSaleId','purchaseId','purchaseReceiptId','receiptId','item','remarks','originalAmount','purchaseAmount','discountPct','reviewRevision'];
const itemFields=['name','itemName','label','qty','quantity','size','variant','variantName','notes','unitAmount','lineAmount','baseAmount','discountAmount','amount','lineTotalFinal','sourceLineIndex'];
const recoveryFields=['id','amount','staffId','originalStart','originalEnd','sourcePayrollRecordId','sourceNetPay','requestedEffectiveDate','reason','version','correctedNetPay','sourceFingerprint','recoveryGeneration','overpaymentAmount'];
const adjustmentFields=['id','amount','staffId','staffName','branch','originalStart','originalEnd','sourcePayrollRecordId','effectiveDate','reason','type','payrollAdjustmentVersion'];
const identityMetadata=row=>({id:row.id,staffId:row.staffId,staffName:row.staffName,frozenData:{staffId:row.frozenData?.staffId,name:row.frozenData?.name,profile:{staffId:row.frozenData?.profile?.staffId,id:row.frozenData?.profile?.id}}});
const array=(rows,project,limit=500)=>{if(!Array.isArray(rows)||rows.length>limit)throw Error('The saved detail needs HQ review.');return rows.map(project);};
const custom=rows=>array(rows,row=>pick(row,['name','amount']),100);
function detail(row){
 const result=pick(row,detailFields),items=row?.items??row?.purchasedItems??row?.selectedItems??row?.cart;
 if(items!==undefined)result.items=array(items,item=>{
  const saved=pick(item,itemFields);if(item?.addons!==undefined){
   if(Array.isArray(item.addons))saved.addons=array(item.addons,option=>typeof option==='string'?option:pick(option,['name','itemName','qty','quantity','amount','price']),100);
   else if(item.addons&&typeof item.addons==='object')saved.addons=Object.fromEntries(Object.entries(item.addons).map(([key,value])=>[key,primitive(value)?value:pick(value,['name','itemName','qty','quantity','amount','price'])]));
   else throw Error('Saved options need HQ review.');
  }return saved;
 },200);
 if(row?.payrollRecovery!==undefined)result.payrollRecovery=pick(row.payrollRecovery,recoveryFields);return result;
}
export function projectPrivatePayrollRecord(row){
 const record=pick(row,['id','staffId','staffName','branch','startDate','endDate','finalNetPay','processedAt','acknowledged','acknowledgedAt','signatureBase64','isPaid','status','paymentStatus','paymentState','pendingSync']);
 if(!row?.frozenData||typeof row.frozenData!=='object'||Array.isArray(row.frozenData))throw Error('The frozen Owner payslip is missing.');
 const source=row.frozenData,saved=pick(source,['staffId','name','branch','start','end','startDate','endDate','isPaid','status','pendingSync','staffSignature','hours','shiftsWorked','penalties','deductionDetailsVersion',...amountFields]);
 if(source.profile!==undefined){saved.profile=pick(source.profile,profileFields);if(source.profile?.customDeductions!==undefined)saved.profile.customDeductions=custom(source.profile.customDeductions);}
 if(source.customDeductions!==undefined)saved.customDeductions=custom(source.customDeductions);
 if(source.logs!==undefined)saved.logs=array(source.logs,row=>pick(row,logFields),1000);
 for(const key of ['deductionDetails','onlineRefundRows','cashShortageRows','ownerDeductionRows','ownerDeductionDetails'])if(source[key]!==undefined)saved[key]=array(source[key],detail);
 for(const key of ['onlineRefundSourceIds','cashShortageSourceIds','ownerDeductionSourceIds'])if(source[key]!==undefined)saved[key]=array(source[key],value=>{if(typeof value!=='string')throw Error('The saved source reference needs review.');return value;});
 for(const key of ['onlineRefundTotal','cashShortageTotal'])if(source[key]!==undefined)saved[key]=pick(source,[key])[key];
 if(source.payrollAdjustmentRows!==undefined)saved.payrollAdjustmentRows=array(source.payrollAdjustmentRows,row=>pick(row,adjustmentFields),40);
 if(source.payrollRecoveryRows!==undefined)saved.payrollRecoveryRows=array(source.payrollRecoveryRows,row=>pick(row,recoveryFields),40);
 record.frozenData=saved;return record;
}
export const PRIVATE_PAYROLL_INPUT_FIELDS=Object.freeze(['staffId','staffName','branch','type','amount','status','dateAdded','timestamp','paidAt','remarks','effectiveDate','scheduleVersion','ownerDeductionVersion','cashShortageVersion','reviewRevision','authorizedAmount','incidentId','sourcePlatform','sourceReceiptId','sourceSaleId','purchaseId','purchaseReceiptId','receiptId','item','label','category','incidentDate','originalAmount','purchaseAmount','discountPct','items','purchasedItems','selectedItems','cart','payrollRecordId','payrollAdjustmentVersion','originalStart','originalEnd','sourcePayrollRecordId','reason','createdByUid','createdByEmail','createIntent','amountPaid','partialPaid','payrollFrozen','payrollRecovery']);
export function projectPrivatePayrollInput(row){
 const result=pick(row,PRIVATE_PAYROLL_INPUT_FIELDS.filter(key=>!['items','purchasedItems','selectedItems','cart','payrollRecovery'].includes(key)));result.id=row.id;
 const projected=detail(row);if(projected.items)result.items=projected.items;if(projected.payrollRecovery)result.payrollRecovery=projected.payrollRecovery;
 if(!['number','string'].includes(typeof row.amount)||!Number.isFinite(Number(row.amount))||Number(row.amount)<0)throw Error('The saved financial amount needs review.');return result;
}
export function createAccessPayrollReader(db,{now=Date.now}={}){
 if(typeof db?.runTransaction!=='function'||typeof db?.collection!=='function')throw Error('A trusted payroll database is required.');
 return async({uid,staffId,deviceId}={})=>{
  if(!accessId(uid)||!accessId(staffId)||typeof deviceId!=='string'||!/^DEV-[A-Z0-9-]{6,80}$/.test(deviceId))denied();
  return db.runTransaction(async tx=>{
   const [configDoc,grantDoc,profileDoc]=await Promise.all(['staff_document_config/current','staff_document_devices/'+uid,'cashiers/'+staffId].map(path=>tx.get(db.doc(path))));
   const config=configDoc.exists?configDoc.data():null,grant=grantDoc.exists?grantDoc.data():null,profile=profileDoc.exists?profileDoc.data():null;
   if(config?.enabled!==true||config.policyVersion!==2||config.brokerEndpoint!=='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'||grant?.active!==true||grant.uid!==uid||grant.staffId!==staffId||grant.deviceId!==deviceId||!activeAccessStaff(profile)||grant.branch!==profile.branch)denied();
   const aliases=aliasesOf(profile);if(!aliases.length||aliases.length>10)review();
   const lookups=[...['staffId','frozenData.staffId','frozenData.profile.staffId','frozenData.profile.id'].map(field=>[field,'==',staffId]),['staffName','in',aliases],['frozenData.name','in',aliases]],found=new Map();let complete=true;
   // Resolve identities using small metadata first. Never materialize hundreds
   // of full frozen payslips while deciding which employee owns a legacy name.
   for(const [field,op,value]of lookups){const query=db.collection('payroll_records').where(field,op,value).limit(251).select('staffId','staffName','frozenData.staffId','frozenData.name','frozenData.profile.staffId','frozenData.profile.id');const result=await tx.get(query);if(result.docs.length>250)complete=false;for(const record of result.docs)found.set(record.id,{...record.data(),id:record.id});}
   const unique=new Map(),held=[],records=[],canonicalIds=new Set();let bytes=0;
   const previews=await tx.get(db.collection('staff_payslip_previews').where('staffId','==',staffId).limit(251).select('staffId','startDate','endDate'));
   if(previews.docs.length>250)complete=false;
   const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
   for(const preview of previews.docs.slice(0,250)){const row=preview.data();if(row.staffId!==staffId||!validDay(row.startDate)||!validDay(row.endDate)||row.startDate>row.endDate){complete=false;continue;}for(const prefix of ['payroll-','refund-payroll-'])canonicalIds.add(prefix+staffId+'-'+row.startDate+'-'+row.endDate);}
   const exactIds=[...canonicalIds];for(let index=0;index<exactIds.length;index+=8){const exact=await Promise.all(exactIds.slice(index,index+8).map(value=>tx.get(db.doc('payroll_records/'+value))));for(const record of exact)if(record.exists)found.set(record.id,identityMetadata({...record.data(),id:record.id}));}
   async function legacy(name){
    if(unique.has(name))return unique.get(name);const owners=new Set();let ambiguous=false;
    for(const field of ['cashierName','fullName','name','scheduleNickname','scheduleName','nickname','scheduleAliases']){const result=await tx.get(db.collection('cashiers').where(field,field==='scheduleAliases'?'array-contains':'==',name).limit(3).select('cashierName'));if(result.docs.length>=3)ambiguous=true;for(const profile of result.docs)owners.add(profile.id);}
    const okay=!ambiguous&&owners.size===1&&owners.has(staffId);unique.set(name,okay);return okay;
   }
   for(const identity of found.values()){
    const saved=identity.frozenData||{},ids=[identity.staffId,saved.staffId,saved.profile?.staffId,saved.profile?.id].filter(value=>value!==undefined&&value!==null&&value!=='');
    if(ids.length&&!ids.includes(staffId)){if(canonicalIds.has(identity.id))held.push({recordId:identity.id,message:'The original payment reference needs HQ review before this shared draft can be displayed.'});continue;}
    if(ids.some(value=>value!==staffId)){held.push({recordId:identity.id,message:'A saved payroll has conflicting employee references. Ask HQ to review it.'});continue;}
    const savedName=typeof saved.name==='string'?saved.name:identity.staffName;
    if(!ids.length&&(!aliases.includes(savedName)||!await legacy(savedName))){complete=false;held.push({...(canonicalIds.has(identity.id)?{recordId:identity.id}:{}),message:'An older saved payroll name is ambiguous. Ask HQ to confirm it.'});continue;}
    try{
     const document=await tx.get(db.doc('payroll_records/'+identity.id));if(!document.exists)throw Error('The saved payroll changed.');const source={...document.data(),id:document.id};
     const projected=projectPrivatePayrollRecord(source);normalizeStaffPayslip(projected,{staffId,legacyNames:!ids.length?[text(savedName)]:[]});
     // Stable identity proof is preserved for the private browser; source records stay unchanged.
     if(!ids.length)projected.staffId=staffId;
     projected.fingerprint=privatePayrollFingerprint(projected);
     const size=Buffer.byteLength(JSON.stringify(projected));if(size>1000000||bytes+size>6*1024*1024||records.length>=250){complete=false;held.push({recordId:source.id,message:'This saved payroll needs a separate HQ review because the private view reached its safe size limit.'});continue;}
     bytes+=size;records.push(projected);
    }catch{held.push({recordId:identity.id,message:'The saved Owner payslip needs HQ review. No figures have been recalculated.'});}
   }
   return{schemaVersion:1,staffId,staffName:profile.cashierName,branch:profile.branch,asOf:new Date(now()).toISOString(),records,held:held.slice(0,250),complete};
  });
 };
}
function signatureBytes(signature){
 if(typeof signature!=='string'||signature.length>349550||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(signature))fail(400,'access/signature','Draw your signature again.');
 const encoded=signature.slice(22),bytes=Buffer.from(encoded,'base64');
 if(bytes.length<45||bytes.length>256*1024||bytes.toString('base64')!==encoded||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.subarray(12,16).toString()!=='IHDR')fail(400,'access/signature','Draw your signature again.');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(width<1||height<1||width>4096||height>2048||width*height>4000000||bytes[24]!==8||![0,2,4,6].includes(bytes[25])||bytes[26]!==0||bytes[27]!==0||bytes[28]!==0)fail(400,'access/signature','Use the signature box to draw a smaller signature.');
 const crc32=data=>{let crc=0xffffffff;for(const value of data){crc^=value;for(let bit=0;bit<8;bit++)crc=crc>>>1^(crc&1?0xedb88320:0);}return(crc^0xffffffff)>>>0;};
 let at=8,ended=false;const chunks=[];while(at<bytes.length){if(at+12>bytes.length)fail(400,'access/signature','Draw your signature again.');const length=bytes.readUInt32BE(at),end=at+12+length;if(end>bytes.length||crc32(bytes.subarray(at+4,end-4))!==bytes.readUInt32BE(end-4))fail(400,'access/signature','Draw your signature again.');const kind=bytes.subarray(at+4,at+8).toString();if(!/^[A-Za-z]{4}$/.test(kind)||kind==='IHDR'&&at!==8||/^[A-Z]/.test(kind)&&!['IHDR','IDAT','IEND','PLTE'].includes(kind))fail(400,'access/signature','Draw your signature again.');if(kind==='IDAT')chunks.push(bytes.subarray(at+8,end-4));if(kind==='IEND'){if(length!==0||end!==bytes.length)fail(400,'access/signature','Draw your signature again.');ended=true;}at=end;}
 if(!ended||!chunks.length)fail(400,'access/signature','Draw your signature again.');
 const channels=({0:1,2:3,4:2,6:4})[bytes[25]],stride=width*channels+1,expected=stride*height;let decoded;
 try{decoded=inflateSync(Buffer.concat(chunks),{maxOutputLength:expected});}catch{fail(400,'access/signature','Draw your signature again.');}
 if(decoded.length!==expected)fail(400,'access/signature','Draw your signature again.');for(let row=0;row<height;row++)if(decoded[row*stride]>4)fail(400,'access/signature','Draw your signature again.');return bytes;
}
const protectedAcknowledgment=row=>{
 const source=row.frozenData||{},arrays=['cashShortageRows','ownerDeductionRows','ownerDeductionDetails','payrollRecoveryRows'];
 return Number(source.cashShortages)>0||Number(source.ownerDeductions)>0||arrays.some(key=>Array.isArray(source[key])&&source[key].length)||['cashShortageSettlements','ownerDeductionSettlements','cashShortagePayrollVersion','ownerDeductionPayrollVersion','cashShortageNoticeId','ownerDeductionNoticeId'].some(key=>row[key]!==undefined||source[key]!==undefined)||(Array.isArray(source.deductionDetails)&&source.deductionDetails.some(detail=>detail?.payrollRecovery||/^(Cash Shortage|Owner Custom Deduction)$/i.test(String(detail?.type||''))));
};
export function createAccessPayrollAcknowledger(db,{now=Date.now,serverTimestamp}={}){
 if(typeof db?.runTransaction!=='function'||typeof serverTimestamp!=='function')throw Error('A trusted payroll acknowledgment store is required.');
 return async({uid,staffId,deviceId,recordId,signatureBase64,expectedFingerprint,operationId}={})=>{
  if(!accessId(uid)||!accessId(staffId)||!accessId(operationId)||operationId.length<8||typeof recordId!=='string'||!/^[-A-Za-z0-9_]{1,250}$/.test(recordId)||!/^DEV-[A-Z0-9-]{6,80}$/.test(deviceId||'')||!/^[a-f0-9]{64}$/.test(expectedFingerprint||''))denied();
  const bytes=signatureBytes(signatureBase64),signatureHash=createHash('sha256').update(bytes).digest('hex'),opId='payroll-ack-'+createHash('sha256').update(uid+'|'+operationId).digest('hex');
  return db.runTransaction(async tx=>{
   const [configDoc,grantDoc,profileDoc,savedDoc,operationDoc]=await Promise.all(['staff_document_config/current','staff_document_devices/'+uid,'cashiers/'+staffId,'payroll_records/'+recordId,'staff_access_operations/'+opId].map(path=>tx.get(db.doc(path))));
   const config=configDoc.exists?configDoc.data():null,grant=grantDoc.exists?grantDoc.data():null,profile=profileDoc.exists?profileDoc.data():null;
   if(config?.enabled!==true||config.policyVersion!==2||config.brokerEndpoint!=='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'||grant?.active!==true||grant.uid!==uid||grant.staffId!==staffId||grant.deviceId!==deviceId||!activeAccessStaff(profile)||grant.branch!==profile.branch)denied();
   if(!savedDoc.exists)review();const source={...savedDoc.data(),id:recordId},frozen=source.frozenData||{},ids=[source.staffId,frozen.staffId,frozen.profile?.staffId,frozen.profile?.id].filter(value=>value!==undefined&&value!==null&&value!=='');
   if(ids.some(value=>value!==staffId))denied();
   const name=typeof frozen.name==='string'?frozen.name:source.staffName,aliases=aliasesOf(profile);
   if(!ids.length){
    if(!aliases.includes(name))denied();const owners=new Set();for(const field of ['cashierName','fullName','name','scheduleNickname','scheduleName','nickname','scheduleAliases']){const result=await tx.get(db.collection('cashiers').where(field,field==='scheduleAliases'?'array-contains':'==',name).limit(3).select('cashierName'));if(result.docs.length>=3)review();for(const owner of result.docs)owners.add(owner.id);}if(owners.size!==1||!owners.has(staffId))review();
   }
   if(protectedAcknowledgment(source))fail(409,'access/payroll-protected','This reviewed-deduction payslip uses its existing protected acknowledgment path. Reopen Pay.');
   const projected=projectPrivatePayrollRecord(source);normalizeStaffPayslip(projected,{staffId,legacyNames:!ids.length?[text(name)]:[]});if(!ids.length)projected.staffId=staffId;
   const prior=operationDoc.exists?operationDoc.data():null;
   if(prior){if(prior.uid!==uid||prior.staffId!==staffId||prior.recordId!==recordId||prior.expectedFingerprint!==expectedFingerprint||prior.signatureHash!==signatureHash||source.acknowledged!==true||source.signatureBase64!==signatureBase64)review();return{schemaVersion:1,staffId,recordId,acknowledged:true,alreadySaved:true};}
   if(source.acknowledged===true||privatePayrollFingerprint(projected)!==expectedFingerprint)review();
   const stamp=serverTimestamp();tx.update(db.doc('payroll_records/'+recordId),{acknowledged:true,acknowledgedAt:stamp,signatureBase64});tx.create(db.doc('staff_access_operations/'+opId),{schemaVersion:1,uid,staffId,recordId,expectedFingerprint,signatureHash,recordedAt:stamp});
   return{schemaVersion:1,staffId,recordId,acknowledged:true,alreadySaved:false};
  });
 };
}
