import {activeAccessStaff,accessId} from './access-model.mjs';
import {PRIVATE_PAYROLL_INPUT_FIELDS,projectPrivatePayrollInput} from './access-payroll-store.mjs';
const fields=['cashierName','fullName','name','scheduleNickname','scheduleName','nickname'],text=value=>typeof value==='string'?value.trim():'';
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
export function createAccessPayrollInputsReader(db,{now=Date.now}={}){
 return async({uid,staffId,deviceId}={})=>{
  if(!accessId(uid)||!accessId(staffId)||!/^DEV-[A-Z0-9-]{6,80}$/.test(deviceId||''))fail(403,'access/approval','Use your approved private Staff phone.');
  return db.runTransaction(async tx=>{
   const [configDoc,grantDoc,profileDoc]=await Promise.all(['staff_document_config/current','staff_document_devices/'+uid,'cashiers/'+staffId].map(path=>tx.get(db.doc(path))));
   const config=configDoc.exists?configDoc.data():null,grant=grantDoc.exists?grantDoc.data():null,profile=profileDoc.exists?profileDoc.data():null;
   if(config?.enabled!==true||config.policyVersion!==2||config.brokerEndpoint!=='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'||grant?.active!==true||grant.uid!==uid||grant.staffId!==staffId||grant.deviceId!==deviceId||!activeAccessStaff(profile)||grant.branch!==profile.branch)fail(403,'access/approval','Use your approved private Staff phone.');
   const names=[...fields.map(key=>profile[key]),...(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[])].filter(value=>typeof value==='string'&&text(value)),aliases=[...new Set(names.flatMap(value=>[value,text(value)]))];if(aliases.length>10||aliases.some(value=>value.length>200))fail(409,'access/payroll-review','The saved financial identity needs HQ review.');
   let complete=true,totalBytes=0;const unique=new Map();
   async function ownedName(name){
    if(unique.has(name))return unique.get(name);const owners=new Set();let ambiguous=false;
    for(const field of [...fields,'scheduleAliases']){const docs=await tx.get(db.collection('cashiers').where(field,field==='scheduleAliases'?'array-contains':'==',name).limit(3).select('cashierName'));if(docs.docs.length>=3)ambiguous=true;for(const row of docs.docs)owners.add(row.id);}
    const known=!ambiguous&&owners.size===1&&owners.has(staffId);unique.set(name,known);return known;
   }
   async function collection(table){
    const metadata=new Map();
    for(const [field,op,value]of [['staffId','==',staffId],['staffName','in',aliases]]){
     let cursor=null;
     for(let page=0;page<20;page++){
      let query=db.collection(table).where(field,op,value).limit(25).select('staffId','staffName');if(cursor)query=query.startAfter(cursor);
      const result=await tx.get(query);
      for(const document of result.docs){const row=document.data();if(row.staffId!=null&&(typeof row.staffId!=='string'||row.staffId.length>160)||row.staffName!=null&&(typeof row.staffName!=='string'||row.staffName.length>200)){complete=false;continue;}metadata.set(document.id,{id:document.id,staffId:row.staffId,staffName:row.staffName});}
      if(result.docs.length<25)break;if(page===19)complete=false;cursor=result.docs.at(-1);
     }
    }
    const result=[];
    for(const record of metadata.values()){
     if(record.staffId!=null&&record.staffId!==staffId)continue;
     if(record.staffId==null&&(!aliases.includes(record.staffName)||!await ownedName(record.staffName))){complete=false;continue;}
     if(result.length>=500){complete=false;break;}
     const [document]=await tx.getAll(db.doc(table+'/'+record.id),{fieldMask:[...PRIVATE_PAYROLL_INPUT_FIELDS]});
     try{if(!document.exists)throw Error('A saved input changed.');const row=projectPrivatePayrollInput({...document.data(),id:document.id});if(row.staffId==null)row.staffId=staffId;const bytes=Buffer.byteLength(JSON.stringify(row));if(bytes>500000||totalBytes+bytes>2*1024*1024){complete=false;continue;}totalBytes+=bytes;result.push(row);}catch{complete=false;}
    }return result;
   }
   const staffDeductions=await collection('staff_deductions'),staffBonuses=await collection('staff_bonuses');
   return{schemaVersion:1,staffId,asOf:new Date(now()).toISOString(),complete,staffDeductions,staffBonuses};
  });
 };
}
