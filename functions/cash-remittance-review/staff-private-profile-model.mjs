import {createHash} from 'node:crypto';
export const PRIVATE_PROFILE_ORIGIN='https://takodeal-staff.vercel.app';
export const CONTACT_FIELDS=Object.freeze(['phone','address','emergencyName','emergencyNumber','emergencyPhone','emergencyContact','emergencyContactNumber','emergNum','email','gcashName','gcashNumber','gotymeName','gotyme','goTymeName','gotymeNumber','gotymeNum','gotymeAcc','gotymeAccount','goTymeNumber','goTymeAccount','gotymeAccountNumber','sss','sssNumber','philhealth','philhealthNumber','pagibig','pagibigNumber']);
export class PrivateProfileError extends Error{constructor(status,code,message){super(message);this.status=status;this.code='staff-private-profile/'+code;}}
export const profileError=(status,code,message)=>new PrivateProfileError(status,code,message);
export const profileId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export const profileDevice=value=>typeof value==='string'&&/^DEV-[A-Z0-9-]{6,80}$/.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const invalid=()=>{throw profileError(400,'request','Reopen your private profile and check the saved fields.');};
export function profileIntent(kind,body){
 const keys=['read','vault-settings'].includes(kind)?['staffId','deviceId']:kind==='vault-save'?['staffId','deviceId','operationId','expectedFingerprint','mode','currentPin','newPin']:['staffId','deviceId','operationId','expectedFingerprint','patch'];
 if(!exact(body,keys)||!profileId(body.staffId)||!profileDevice(body.deviceId))invalid();
 if(['read','vault-settings'].includes(kind))return{...body};
 if(kind==='vault-save'){if(!profileId(body.operationId)||body.operationId.length<8||!/^[a-f0-9]{64}$/.test(body.expectedFingerprint||'')||!['setup','change'].includes(body.mode)||typeof body.currentPin!=='string'||body.currentPin!==body.currentPin.trim()||!/^[\x20-\x7e]{1,100}$/.test(body.currentPin)||typeof body.newPin!=='string'||!/^\d{6,8}$/.test(body.newPin))invalid();return{...body};}
 if(kind!=='update'||!profileId(body.operationId)||body.operationId.length<8||!/^[a-f0-9]{64}$/.test(body.expectedFingerprint||'')||!object(body.patch)||!Object.keys(body.patch).length||Object.keys(body.patch).some(key=>!CONTACT_FIELDS.includes(key)))invalid();
 const patch={};for(const [key,value]of Object.entries(body.patch)){if(typeof value!=='string'||value!==value.trim()||value.length>(key==='address'?2000:320)||/[\u0000-\u001f\u007f]/.test(value))invalid();patch[key]=value;}
 return{staffId:body.staffId,deviceId:body.deviceId,operationId:body.operationId,expectedFingerprint:body.expectedFingerprint,patch};
}
function canonical(value){
 if(value===undefined)return['undefined'];
 if(value?.toDate&&typeof value.toDate==='function')return['timestamp',value.seconds??value._seconds,value.nanoseconds??value._nanoseconds];
 if(value instanceof Date)return['date',value.toISOString()];
 if(Array.isArray(value))return value.map(canonical);
 if(object(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export const profileHash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function privateProfileFingerprint(snapshot){const time=snapshot.updateTime;if(!profileId(snapshot.id)||!time||!Number.isSafeInteger(time.seconds)||!Number.isSafeInteger(time.nanoseconds)||time.nanoseconds<0||time.nanoseconds>=1000000000)throw profileError(503,'unavailable','Your current profile could not be confirmed. Reconnect and try again.');return profileHash({path:'cashiers/'+snapshot.id,revision:[time.seconds,time.nanoseconds]});}
const scalarFields=[...CONTACT_FIELDS,'cashierName','fullName','name','branch','role','scheduleNickname','scheduleName','nickname','dateHired','contractStatus','hourlyRate','dailyRate','salaryRateVersion','salaryRateRevision','eligibleNightDiff','nightDiffRate','sssAmount','philHealthAmount','pagibigAmount','loginPinVersion'];
const review=()=>{throw profileError(409,'review','Your saved profile needs HQ review before it can be displayed.');};
const string=(value,max=2000)=>{if(typeof value!=='string'||value.length>max)review();return value;};
const amount=value=>{if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())||!Number.isFinite(Number(value))||Number(value)<0)review();return value;};
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
function dateValue(value){if(value===null||value==='')return value;let converted=value;if(value instanceof Date||typeof value?.toDate==='function'){const parsed=value instanceof Date?value:value.toDate();if(!(parsed instanceof Date)||!Number.isFinite(+parsed))review();converted=parsed.toISOString();}string(converted,200);if(!Number.isFinite(Date.parse(converted))||/^\d{4}-\d{2}-\d{2}$/.test(converted)&&!day(converted))review();return converted;}
function salaryTimeline(timeline,staffId,branch){
 if(!object(timeline)||timeline.staffId!==staffId||timeline.branch!==branch||timeline.version!==1||!Number.isSafeInteger(timeline.revision)||timeline.revision<1||!object(timeline.rates)||Object.keys(timeline.rates).length>500)review();
 const entries=[];for(const [id,row]of Object.entries(timeline.rates)){if(!profileId(id)||!object(row)||!day(row.effectiveDate)||!Number.isSafeInteger(row.sequence)||row.sequence<1||row.sequence>timeline.revision)review();entries.push([id,{effectiveDate:row.effectiveDate,dailyRate:amount(row.dailyRate),sequence:row.sequence}]);}
 return{staffId,branch,version:1,revision:timeline.revision,baselineDailyRate:timeline.baselineDailyRate===null?null:amount(timeline.baselineDailyRate),rates:Object.fromEntries(entries)};
}
export function projectPrivateProfile(staffId,source,timeline){
 const profile={staffId};for(const key of scalarFields)if(Object.hasOwn(source,key)){const value=source[key];if(key==='dateHired'){profile[key]=dateValue(value);continue;}if(!['string','number','boolean'].includes(typeof value)&&value!==null||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>2000)review();profile[key]=value;}
 if(!Number.isSafeInteger(profile.loginPinVersion??0)||(profile.loginPinVersion??0)<0)throw profileError(409,'review','Your daily PIN settings need HQ review.');profile.loginPinVersion??=0;
 if(source.roleHistory!==undefined){if(!Array.isArray(source.roleHistory)||source.roleHistory.length>100)review();profile.roleHistory=source.roleHistory.map(row=>{if(!object(row))review();return{...(Object.hasOwn(row,'role')?{role:string(row.role,200)}:{}),...(Object.hasOwn(row,'date')?{date:dateValue(row.date)}:{})};});}
 if(source.customDeductions!==undefined){if(!Array.isArray(source.customDeductions)||source.customDeductions.length>100)review();profile.customDeductions=source.customDeductions.map(row=>{if(!object(row))review();return{name:string(row.name,200),amount:amount(row.amount)};});}
 if(source.signedContracts!==undefined){if(!object(source.signedContracts))review();profile.signedContracts=Object.fromEntries(['initial','extension','regularization'].filter(key=>Object.hasOwn(source.signedContracts,key)).map(key=>[key,dateValue(source.signedContracts[key])]));}
 if(source.latestRateRaise!==undefined&&source.latestRateRaise!==null){const row=source.latestRateRaise;if(!object(row)||Object.hasOwn(row,'version')&&(!Number.isSafeInteger(row.version)||row.version<0))review();profile.latestRateRaise={...(Object.hasOwn(row,'version')?{version:row.version}:{}),...(Object.hasOwn(row,'eventId')?{eventId:string(row.eventId,128)}:{})};}
 if(timeline!==undefined)profile.salaryRateTimeline=salaryTimeline(timeline,staffId,source.branch);
 return profile;
}
