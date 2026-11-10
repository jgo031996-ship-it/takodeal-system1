import {createHash} from 'node:crypto';
export const DOCUMENT_IMAGE_ENDPOINT='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker';
export const DOCUMENT_MAX_BYTES=2*1024*1024;
export const documentId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export const documentHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const documentGroup=value=>['valid_id','health_card','clearance','sss_id','philhealth_id','pagibig_id'].includes(value);
export const documentBranch=value=>typeof value==='string'&&value.trim().length>0&&value.length<=128;
export const documentObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export class DocumentMetadataError extends Error {constructor(status,code,message){super(message);this.status=status;this.code='document-metadata/'+code;}}
export const documentError=(status,code,message)=>new DocumentMetadataError(status,code,message);
export function documentDeny(){throw documentError(403,'permission-denied','Private document access changed. Ask HQ to review this account or phone.');}
export function documentChanged(){throw documentError(409,'changed','This document changed. Refresh the profile before continuing.');}
const day=value=>value===''||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1000&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const details=(group,clearance,expiry)=>typeof clearance==='string'&&day(expiry)&&(group==='clearance'?['NBI','POLICE'].includes(clearance):clearance==='');
const exact=(value,keys)=>documentObject(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function documentUploadIntent(value){
 const keys=['staffId','group','uploadId','expectedVersion','sha256','size','clearanceType','expiresOn'];
 if(!exact(value,keys)||!documentId(value.staffId)||!documentGroup(value.group)||!documentId(value.uploadId)||!documentHash(value.sha256)||!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<0||value.expectedVersion>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(value.size)||value.size<6||value.size>DOCUMENT_MAX_BYTES||!details(value.group,value.clearanceType,value.expiresOn))throw documentError(400,'invalid-request','Choose the exact private photo and details again.');
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
export function documentReviewIntent(value){
 const keys=['staffId','group','uploadId','expectedVersion','sha256','reviewId','status','note'];
 if(!exact(value,keys)||!documentId(value.staffId)||!documentGroup(value.group)||!documentId(value.uploadId)||!documentHash(value.sha256)||!documentId(value.reviewId)||!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<1||value.expectedVersion>=Number.MAX_SAFE_INTEGER||!['approved','rejected'].includes(value.status)||typeof value.note!=='string'||value.note!==value.note.trim()||value.note.length>300||value.status==='rejected'&&value.note.length<3)throw documentError(400,'invalid-request','Refresh the exact document and add a clear review reason.');
 return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
export const documentTimestamp=value=>value instanceof Date?Number.isFinite(+value):documentObject(value)&&Number.isSafeInteger(value.seconds??value._seconds)&&Number.isSafeInteger(value.nanoseconds??value._nanoseconds??0)&&(value.nanoseconds??value._nanoseconds??0)>=0&&(value.nanoseconds??value._nanoseconds??0)<1000000000;
const timestamp=documentTimestamp;
export function documentCanonical(value){
 const normalize=item=>item instanceof Date?['$date',+item]:timestamp(item)?['$timestamp',item.seconds??item._seconds, item.nanoseconds??item._nanoseconds??0]:Array.isArray(item)?item.map(normalize):documentObject(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,normalize(item[key])])):item;
 return JSON.stringify(normalize(value));
}
export const documentFingerprint=value=>createHash('sha256').update(documentCanonical(value)).digest('hex');
export const documentStoragePath=(uid,input)=>`staff_private_documents/${uid}/${input.staffId}/${input.group}/${input.uploadId}.jpg`;
export const DOCUMENT_CORE_FIELDS=Object.freeze(['staffId','branch','group','uploadId','uploadedByUid','storagePath','contentType','size','sha256','clearanceType','expiresOn']);
const required=[...DOCUMENT_CORE_FIELDS,'status','reviewNote','version','uploadedAt','updatedAt'],allowed=[...required,'reviewId','reviewedByUid','reviewedAt'];
export function assertDocumentRecord(row,{staffId,group,branch}){
 if(!documentObject(row)||required.some(key=>!Object.hasOwn(row,key))||Object.keys(row).some(key=>!allowed.includes(key))||row.staffId!==staffId||row.group!==group||row.branch!==branch||!documentId(row.uploadId)||!documentId(row.uploadedByUid)||row.storagePath!==documentStoragePath(row.uploadedByUid,row)||row.contentType!=='image/jpeg'||!Number.isSafeInteger(row.size)||row.size<6||row.size>DOCUMENT_MAX_BYTES||!documentHash(row.sha256)||!details(group,row.clearanceType,row.expiresOn)||!Number.isSafeInteger(row.version)||row.version<1||!['pending_review','approved','rejected'].includes(row.status)||typeof row.reviewNote!=='string'||row.reviewNote.length>300||!timestamp(row.uploadedAt)||!timestamp(row.updatedAt)||row.status==='rejected'&&row.reviewNote.length<3||row.status!=='pending_review'&&(!documentId(row.reviewId)||!documentId(row.reviewedByUid)||!timestamp(row.reviewedAt)))documentChanged();
 if(row.status==='pending_review'&&Object.keys(row).length!==required.length||row.status!=='pending_review'&&(Object.keys(row).length!==allowed.length||documentCanonical(row.reviewedAt)!==documentCanonical(row.updatedAt)))documentChanged();
 return row;
}
export function documentUploadMatches(row,input,uid,branch){return row&&row.staffId===input.staffId&&row.group===input.group&&row.branch===branch&&row.uploadId===input.uploadId&&row.uploadedByUid===uid&&row.storagePath===documentStoragePath(uid,input)&&row.contentType==='image/jpeg'&&['size','sha256','clearanceType','expiresOn'].every(key=>row[key]===input[key]);}
export function assertDocumentAttestation(value,{kind,input,uid,branch,record}){
 const keys=['purpose',...DOCUMENT_CORE_FIELDS,'generation'];
 if(!exact(value,keys)||value.purpose!==(kind==='upload'?'upload':'review')||value.branch!==branch||typeof value.generation!=='string'||!/^[1-9]\d{0,39}$/.test(value.generation)||kind==='upload'&&!documentUploadMatches(value,input,uid,branch)||kind==='review'&&DOCUMENT_CORE_FIELDS.some(key=>value[key]!==record[key]))documentChanged();
 return value;
}
