import {attendanceMillis} from './attendance-reconcile.js';
import {phDay} from './sanction-schedule.js';
export const CASH_SHORTAGE_TYPE='Cash Shortage';
export const CASH_SHORTAGE_COLLECTION='cash_shortage_reviews';
export const CASH_SHORTAGE_BASES=Object.freeze(['Legal authority permitting this deduction','Court / authorized agency order']);
export const CASH_SHORTAGE_LIMIT=6;
export function cashShortageId(shiftId){if(typeof shiftId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(shiftId))throw Error('Choose a saved shift ID.');return 'cash-shortage-'+shiftId;}
export function cashShortageCents(value){if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^\d+(?:\.\d+)?$/.test(value.trim())||String(value).trim()==='')throw Error('The saved cash amount is missing or invalid.');const cents=Math.round(Number(value)*100);if(!Number.isSafeInteger(cents)||cents<0||cents>100000000000)throw Error('The cash amount is outside the permitted range.');return cents;}
const canonical=value=>value instanceof Date||typeof value?.toDate==='function'||typeof value?.toMillis==='function'||value&&Number.isFinite(value.seconds)?new Date(attendanceMillis(value)).toISOString():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
export function cashShortageSource(shiftId,shift){
 cashShortageId(shiftId);if(!shift||shift.status!=='Closed'||shift.active!==false||!shift.branch||!Number.isFinite(attendanceMillis(shift.startTime))||!Number.isFinite(attendanceMillis(shift.endTime))||attendanceMillis(shift.endTime)<attendanceMillis(shift.startTime))throw Error('Only a completed closed shift with verified cash totals can be reviewed.');
 if(typeof shift.expectedCash!=='number'||typeof shift.declaredCash!=='number')throw Error('The closed shift must contain saved numeric cash totals.');
 const expected=cashShortageCents(shift.expectedCash),declared=cashShortageCents(shift.declaredCash),loss=expected-declared;
 if(loss<=5)throw Error('This shift has no cash shortage greater than five centavos.');
 const fields=['branch','status','active','startTime','endTime','expectedCash','declaredCash','startingCash','cashOut','totalCashSales','salesRevision','settlementId'];
 const sourceFingerprint=JSON.stringify(canonical({id:shiftId,...Object.fromEntries(fields.filter(key=>shift[key]!==undefined).map(key=>[key,shift[key]]))}));
 return {sourceShiftId:shiftId,sourceReceiptId:shiftId,sourcePlatform:'Z-reading',branch:shift.branch,expectedCash:expected/100,declaredCash:declared/100,sourceShortage:loss/100,sourceShortageCents:loss,sourceFingerprint};
}
export const isCashShortageDeduction=row=>row?.type===CASH_SHORTAGE_TYPE||String(row?.id||row?.incidentId||'').startsWith('cash-shortage-');
export function cashShortageStaff(profile,staffId){if(typeof staffId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(staffId)||!profile||typeof profile.cashierName!=='string'||!profile.cashierName.trim()||!profile.branch||profile.active===false||profile.archived===true||profile.blocked===true||/blocked|inactive|disabled|revoked|terminated|archived|resigned|deleted/i.test(String(profile.status||'')))throw Error('Choose the exact active employee account for review.');return {staffId,staffName:profile.cashierName,staffBranch:profile.branch};}
export function validateCashShortageLink(deduction,review,notice,{staffId,name,branch,end,shift}={}){
 const fail=()=>{throw Error('A cash shortage review, staff response or authorized amount changed. Regenerate this unpaid payslip.');};
 if(!deduction||!review||!notice)return fail();
 const id=deduction.id||deduction.incidentId;
 if(id!==cashShortageId(review.sourceShiftId)||review.id!==id||deduction.incidentId!==id||notice.id!==id||notice.incidentId!==id||deduction.type!==CASH_SHORTAGE_TYPE||review.type!==CASH_SHORTAGE_TYPE||notice.type!==CASH_SHORTAGE_TYPE||deduction.cashShortageVersion!==1||review.schemaVersion!==1||notice.version!==1||review.status!=='Approved'||deduction.status!=='Unpaid'||notice.status!=='Approved'||!Number.isSafeInteger(review.revision)||review.revision<2||deduction.reviewRevision!==review.revision||notice.noticeRevision!==review.revision)return fail();
 for(const row of [review,deduction,notice])if(row.staffId!==staffId||row.staffName!==name||row.sourceShiftId!==review.sourceShiftId||row.sourceReceiptId!==review.sourceShiftId||row.sourcePlatform!=='Z-reading')return fail();
 if(deduction.branch!==branch||review.staffBranch!==branch||notice.branch!==branch||deduction.sourceBranch!==review.branch||!review.sourceFingerprint||!Number.isSafeInteger(review.sourceShortageCents)||review.sourceShortageCents<=5||cashShortageCents(review.expectedCash)-cashShortageCents(review.declaredCash)!==review.sourceShortageCents)return fail();
 const amount=cashShortageCents(review.amount);if(!amount||amount>review.sourceShortageCents||[review.authorizedAmount,deduction.amount,deduction.authorizedAmount,notice.amount].some(value=>cashShortageCents(value)!==amount)||review.responsibilityConfirmed!==true||review.lawfulAuthorityConfirmed!==true||!CASH_SHORTAGE_BASES.includes(review.lawfulBasis)||String(review.authorityReference||'').trim().length<8||String(review.finding||'').trim().length<15||!Number.isSafeInteger(review.replyRevisionReviewed)||review.replyRevisionReviewed<1||notice.replyRevision!==review.replyRevisionReviewed||!String(notice.staffReply||'').trim())return fail();
 if(notice.lawfulBasis!==review.lawfulBasis||notice.authorityReference!==review.authorityReference||notice.finding!==review.finding||notice.ownerReply!==review.finding||[deduction,review,notice].some(row=>['paidAt','payrollRecordId','payrollFrozen','partialPaid','amountPaid'].some(key=>Object.hasOwn(row,key))))return fail();
 const effectiveDate=phDay(review.effectiveDate);if(!review.effectiveDate||deduction.effectiveDate!==effectiveDate||notice.effectiveDate!==effectiveDate)return fail();
 if(shift){const current=cashShortageSource(review.sourceShiftId,shift);if(current.sourceFingerprint!==review.sourceFingerprint||current.sourceShortageCents!==review.sourceShortageCents||current.branch!==review.branch)return fail();}
 if(end&&effectiveDate>phDay(end))return null;
 return {id,amount:amount/100,effectiveDate,revision:review.revision,sourceShiftId:review.sourceShiftId};
}
