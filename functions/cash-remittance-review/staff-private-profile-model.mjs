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
export function privateProfileFingerprint(snapshot){const time=snapshot.updateTime;if(!time||!Number.isSafeInteger(time.seconds)||!Number.isSafeInteger(time.nanoseconds))throw profileError(503,'unavailable','Your current profile could not be confirmed. Reconnect and try again.');return profileHash({profile:snapshot.data(),revision:[time.seconds,time.nanoseconds]});}
const scalarFields=[...CONTACT_FIELDS,'cashierName','fullName','name','branch','role','scheduleNickname','scheduleName','nickname','dateHired','contractStatus','hourlyRate','dailyRate','salaryRateVersion','salaryRateRevision','eligibleNightDiff','nightDiffRate','sssAmount','philHealthAmount','pagibigAmount','loginPinVersion'];
function safeValue(value,depth=0){
 if(depth>5)throw Error('Profile value is too deep.');
 if(value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='string'&&value.length<=2000)return value;
 if(value?.toDate&&typeof value.toDate==='function')return value.toDate().toISOString();
 if(value instanceof Date)return value.toISOString();
 if(Array.isArray(value)&&value.length<=500)return value.map(row=>safeValue(row,depth+1));
 if(object(value)&&Object.keys(value).length<=500)return Object.fromEntries(Object.entries(value).map(([key,row])=>{if(!/^[A-Za-z0-9_-]{1,128}$/.test(key))throw Error('Invalid profile key.');return[key,safeValue(row,depth+1)];}));
 throw Error('Invalid private display value.');
}
export function projectPrivateProfile(staffId,source,timeline){
 const profile={staffId};for(const key of scalarFields)if(Object.hasOwn(source,key)){const value=source[key];if(!['string','number','boolean'].includes(typeof value)&&value!==null)throw profileError(409,'review','Your profile needs HQ review before it can be displayed.');profile[key]=safeValue(value);}
 if(!Number.isSafeInteger(profile.loginPinVersion??0)||(profile.loginPinVersion??0)<0)throw profileError(409,'review','Your daily PIN settings need HQ review.');profile.loginPinVersion??=0;
 for(const [key,fields,max]of [['roleHistory',['role','date'],100],['customDeductions',['name','amount'],100]])if(source[key]!==undefined){if(!Array.isArray(source[key])||source[key].length>max)throw profileError(409,'review','Your saved profile history needs HQ review.');profile[key]=source[key].map(row=>{if(!object(row))throw profileError(409,'review','Your saved profile history needs HQ review.');return Object.fromEntries(fields.filter(field=>Object.hasOwn(row,field)).map(field=>[field,safeValue(row[field])]));});}
 if(source.signedContracts!==undefined){if(!object(source.signedContracts))throw profileError(409,'review','Your saved contract history needs HQ review.');profile.signedContracts=Object.fromEntries(['initial','extension','regularization'].filter(key=>Object.hasOwn(source.signedContracts,key)).map(key=>[key,safeValue(source.signedContracts[key])]));}
 if(source.latestRateRaise!==undefined&&object(source.latestRateRaise))profile.latestRateRaise=Object.fromEntries(['version','eventId'].filter(key=>Object.hasOwn(source.latestRateRaise,key)).map(key=>[key,safeValue(source.latestRateRaise[key])]));
 if(timeline!==undefined)profile.salaryRateTimeline=safeValue(timeline);
 return profile;
}
