import {createHash} from 'node:crypto';
import {buildStaffLoanLedgerSnapshot} from './staff-loan-ledger-model.mjs';
const deny=()=>{throw Object.assign(Error('Use your personally approved Staff phone. Ask HQ to check private access.'),{status:403,code:'staff-loans/approval'});};
const review=()=>{throw Object.assign(Error('Your saved loan identity or history needs HQ review. No balance has been estimated.'),{status:409,code:'staff-loans/review'});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
const text=value=>typeof value==='string'?value.trim():'';
const former=/^(blocked|revoked|terminated|resigned|inactive|disabled|archived|deleted|offboarded|offboard|finished contract|contract ended|end of contract)$/i;
const inactive=row=>!row||row.active===false||row.isActive===false||['archived','isArchived','deleted','isDeleted','blocked','revoked','offboarded','resigned','terminated','disabled'].some(field=>row[field]===true)||[row.status,row.employmentStatus].some(value=>former.test(text(value)))||/^(resigned|terminated|revoked|offboarded)$/i.test(text(row.contractStatus))||/^(REVOKED|BLOCKED)$/i.test(text(row.pin));
const nameFields=['cashierName','fullName','name','scheduleNickname','scheduleName','nickname'];
const sourceFields={staff_ledger:['staffId','staffName','branch','totalLoaned','totalPaid','cutoffDeduction'],staff_deductions:['staffId','staffName','branch','type','amount','status','dateAdded','paidAt','remarks','payrollRecordId']};
export function createStaffLoanLedgerStore(db,{now=Date.now}={}){
 if(typeof db?.runTransaction!=='function'||typeof db?.doc!=='function'||typeof db?.collection!=='function')throw Error('A trusted loan database is required.');
 async function authority(tx,{uid,staffId,deviceId}){
  if(!id(uid)||!id(staffId)||!/^DEV-[A-Z0-9-]{6,80}$/.test(deviceId||''))deny();
  const refs=['staff_document_config/current','staff_document_devices/'+uid,'cashiers/'+staffId];
  const [configSnap,bindingSnap,profileSnap]=await Promise.all(refs.map(path=>tx.get(db.doc(path))));
  const config=configSnap.exists?configSnap.data():null,binding=bindingSnap.exists?bindingSnap.data():null,profile=profileSnap.exists?profileSnap.data():null;
  if(config?.enabled!==true||config.policyVersion!==2||config.brokerEndpoint!=='https://asia-southeast1-takodeal-pos.cloudfunctions.net/staffDocumentBroker'||binding?.active!==true||binding.uid!==uid||binding.staffId!==staffId||binding.deviceId!==deviceId||inactive(profile)||!text(profile.cashierName)||!text(profile.branch)||binding.branch!==profile.branch)deny();
  return profile;
 }
 async function read(scope){
  return db.runTransaction(async tx=>{
   const profile=await authority(tx,scope),staffName=text(profile.cashierName),branch=text(profile.branch),savedNames=[...nameFields.map(field=>profile[field]),...(Array.isArray(profile.scheduleAliases)?profile.scheduleAliases:[])].filter(value=>typeof value==='string'&&text(value)),aliases=[...new Set(savedNames.flatMap(value=>[value,text(value)]))];
   if(aliases.length>10)review();
   let historyComplete=true,reviewRequired=false;
   const query=async(table,field,value,cap)=>{
    let q=db.collection(table).where(field,'==',value).limit(cap);
    q=q.select(...(sourceFields[table]||['cashierName']));
    const snap=await tx.get(q);if(!Array.isArray(snap.docs))review();
    return{rows:snap.docs.map(row=>({...row.data(),id:row.id})),overflow:snap.docs.length>=cap};
   };
   const grouped={staff_ledger:new Map(),staff_deductions:new Map()};
   for(const table of Object.keys(grouped)){
    const result=await Promise.all([query(table,'staffId',scope.staffId,table==='staff_ledger'?21:501),...aliases.map(name=>query(table,'staffName',name,table==='staff_ledger'?21:501))]);
    for(const group of result){if(group.overflow){reviewRequired=true;if(table==='staff_deductions')historyComplete=false;else review();}for(const row of group.rows){if(!id(row.id))review();grouped[table].set(row.id,row);}}
   }
   const legacyNames=[...new Set(Object.values(grouped).flatMap(rows=>[...rows.values()]).filter(row=>row.staffId==null).map(row=>row.staffName))],unique=new Set();
   for(const name of legacyNames){
    if(!aliases.includes(name)){reviewRequired=true;continue;}
    const matches=new Set();let ambiguous=false;
    for(const field of nameFields){const found=await query('cashiers',field,name,3);if(found.overflow)ambiguous=true;for(const row of found.rows)matches.add(row.id);}
    // A legacy alias list can also belong to a different employee.
    let aliasQuery=db.collection('cashiers').where('scheduleAliases','array-contains',name).limit(3).select('cashierName');
    const aliasSnap=await tx.get(aliasQuery);if(aliasSnap.docs.length>=3)ambiguous=true;for(const row of aliasSnap.docs)matches.add(row.id);
    if(!ambiguous&&matches.size===1&&matches.has(scope.staffId))unique.add(name);else reviewRequired=true;
   }
   const owned=rows=>[...rows.values()].filter(row=>{
    if(row.staffId!=null){if(row.staffId!==scope.staffId)return false;}
    else if(!unique.has(row.staffName))return false;
    if(row.branch!=null&&row.branch!==branch){reviewRequired=true;return false;}
    return true;
   });
   const ledgers=owned(grouped.staff_ledger),history=owned(grouped.staff_deductions).filter(row=>['Company Loan Issued','Company Loan Payment'].includes(row.type));
   // Ambiguous legacy sources can hide a second ledger; never show a partial
   // balance as confirmed merely because a stable-ID row was also found.
   const unsafeLedger=[...grouped.staff_ledger.values()].some(row=>row.staffId==null&&!unique.has(row.staffName)||row.staffId===scope.staffId&&row.branch!=null&&row.branch!==branch);
   if(unsafeLedger)review();
   if(reviewRequired)historyComplete=false;
   return buildStaffLoanLedgerSnapshot({staffId:scope.staffId,staffName,branch,asOf:new Date(now()),ledgers,history,historyComplete,reviewRequired});
  });
 }
 return{read,async rate(uid){
  if(!id(uid))deny();const slot=Math.floor(now()/60000),path='cash_remittance_attempts/loan-'+createHash('sha256').update(uid+'|'+slot).digest('hex');
  await db.runTransaction(async tx=>{const snap=await tx.get(db.doc(path)),row=snap.exists?snap.data():null,count=row?.count??0;if(!Number.isSafeInteger(count)||count<0||count>=30)throw Object.assign(Error('Too many loan checks. Wait a minute before refreshing.'),{status:429,code:'staff-loans/rate-limit'});tx.set(db.doc(path),{count:count+1,expiresAt:new Date((slot+2)*60000).toISOString()});});
 }};
}
