import {createHash} from 'node:crypto';
import {accessId,accessDocumentId} from './access-model.mjs';
export const HQ_UPLOAD_PURPOSES=Object.freeze({
 'request-proof':{table:'staff_requests',permissions:['all','inbox','payroll']},
 'discipline-evidence':{table:'cashiers',permissions:['all','payroll','sanctions']},
 'inventory-photo':{table:'inventory',permissions:['all','inventory','overview']},
 'waste-proof':{table:'inventory',permissions:['all','inventory','waste']}
});
export const HQ_UPLOAD_MAX=5*1024*1024;
export const uploadError=(status,code,message)=>Object.assign(Error(message),{status,code});
export const uploadDenied=()=>{throw uploadError(403,'hq-upload/access','Your saved account does not allow this attachment for this branch.');};
export function uploadIntent(body){
 const required=['operationId','purpose','mime','size','sha256'],allowed=[...required,'sourceId','branch'];
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key))||required.some(key=>!Object.hasOwn(body,key))||!accessId(body.operationId)||body.operationId.length<16||!Object.hasOwn(HQ_UPLOAD_PURPOSES,body.purpose)||!['image/jpeg','image/png','image/webp'].includes(body.mime)||!Number.isSafeInteger(body.size)||body.size<1||body.size>HQ_UPLOAD_MAX||typeof body.sha256!=='string'||!/^[a-f0-9]{64}$/.test(body.sha256))throw uploadError(400,'hq-upload/request','Choose a JPG, PNG or WebP attachment up to 5 MB and reopen its review.');
 const existing=accessDocumentId(body.sourceId),newInventory=body.purpose==='inventory-photo'&&body.sourceId===undefined&&typeof body.branch==='string'&&body.branch.trim()===body.branch&&body.branch.length>0&&body.branch.length<=120;
 if(!existing&&!newInventory||existing&&body.branch!==undefined)throw uploadError(400,'hq-upload/source','Reopen the exact saved attachment source.');
 return Object.fromEntries(allowed.filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
}
export const uploadHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const uploadGrantId=(uid,operationId)=>'hqupload-'+uploadHash([uid,operationId]);
export const uploadPath=(uid,id,intent)=>'hq_business_files/'+uid+'/'+id+'/'+intent.sha256+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[intent.mime]);
