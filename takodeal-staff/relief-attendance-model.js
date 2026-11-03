import {attendanceMillis} from './attendance-reconcile.js';
const text=value=>typeof value==='string'?value.trim():'';
const key=value=>text(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
const branch=value=>text(value)&&!['unknown','unassigned','all'].includes(key(value))?text(value):'';
const id=value=>typeof value==='string'&&value.length>0&&value.length<=150&&!/[\/\0]/.test(value);

// This marker describes a cross-branch punch only. It never establishes the
// assigned shift, approves departure, changes location access or sets pay.
export function validEmergencyReliefMarker(value,actualBranch){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4
  ||value.version!==1||value.requiresReview!==true||!branch(value.homeBranch)||!branch(value.branch)
  ||value.homeBranch!==text(value.homeBranch)||value.branch!==text(value.branch)
  ||key(value.homeBranch)===key(value.branch)||value.branch!==text(actualBranch))return null;
 return {version:1,homeBranch:value.homeBranch,branch:value.branch,requiresReview:true};
}
export function emergencyReliefMarker(start={},profile={}){
 const actual=branch(start.branch),home=branch(profile.branch);
 if(!actual)return null;
 if(home&&key(home)!==key(actual))return {version:1,homeBranch:home,branch:actual,requiresReview:true};
 // A later home-branch transfer does not erase what the original punch recorded.
 return validEmergencyReliefMarker(start.emergencyRelief,actual);
}
export function isEmergencyReliefRequest(row){
 const timeIn=attendanceMillis(row?.timeInAt),timeOut=attendanceMillis(row?.actualTimeOutAt);
 return !!row&&row.type==='Early Time Out'&&row.schemaVersion===1&&row.requiresScheduleReview===true
  &&!!validEmergencyReliefMarker(row.emergencyRelief,row.branch)&&id(row.staffId)&&id(row.timeInLogId)
  &&/^time-out-[a-f0-9]{64}$/.test(row.timeOutLogId||'')&&Number.isFinite(timeIn)&&Number.isFinite(timeOut)
  &&timeOut>=timeIn&&timeOut-timeIn<=24*3600000;
}
