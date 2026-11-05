import {ownerDeductionCandidates,isOwnerDeduction,validateOwnerDeductionLink,OWNER_DEDUCTION_LIMIT,OWNER_DEDUCTION_TYPE} from './owner-deduction-model.js';
import {OWNER_EMAIL} from './workspace-access-model.js';
import {assertPayrollRecoverySource} from './payroll-recovery-model.js';

const cents=value=>{if(value==null||value==='')value=0;if(!['number','string'].includes(typeof value)||typeof value==='string'&&!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()))throw Error('Review the owner-added deduction amounts.');const result=Math.round(Number(value)*100);if(!Number.isSafeInteger(result)||result<0||result>1000000000000)throw Error('Review the owner-added deduction amounts.');return result;};
const validId=value=>typeof value==='string'&&/^owner-deduction-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const changed=()=>Error('An owner-added deduction changed. Regenerate this unpaid payslip.');
const actor=api=>{const user=api.auth?.currentUser,session=api.sessionUser;if(!user?.uid||user.email?.toLowerCase()!==OWNER_EMAIL||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||session?.uid!==user.uid||session.email?.toLowerCase()!==OWNER_EMAIL||session.isOwner!==true||session.isFranchisee===true)throw Error('The verified Owner must review owner-added payroll deductions.');return JSON.stringify([user.uid,user.email,user.emailVerified,session.uid,session.email,session.permissions,session.allowedBranches,session.isOwner,session.isFranchisee]);};

export function payrollOwnerDeductionRows(data){
 const source=data.ownerDeductionRows??[];if(!Array.isArray(source)||source.length>OWNER_DEDUCTION_LIMIT)throw Error('Review the linked owner-added deductions before paying.');
 const seen=new Set(),rows=source.map(row=>{if(!row||!validId(row.id)||seen.has(row.id)||cents(row.amount)<=0)throw changed();seen.add(row.id);return {id:row.id,amount:cents(row.amount)/100};});
 if(rows.reduce((sum,row)=>sum+cents(row.amount),0)!==cents(data.ownerDeductions))throw Error('Owner-added deduction details do not match the payslip total.');return rows;
}
export function ownerDeductionDisplayRows(rows){return rows.map(row=>({id:row.id,type:OWNER_DEDUCTION_TYPE,bucket:'ownerDeductions',amount:cents(row.amount)/100,label:row.label,category:row.category,incidentDate:row.incidentDate,effectiveDate:row.effectiveDate,reviewRevision:row.revision}));}
// The existing Rules require the exact base detail maps above. Keep recovery
// source facts in a separate frozen list without changing that protected tuple.
export function ownerDeductionRecoveryRows(rows){return rows.filter(row=>row.payrollRecovery).map(row=>({id:row.id,amount:cents(row.amount)/100,...row.payrollRecovery}));}
export async function assertPayrollRecoverySources(rows,read,{crypto}={}){
 const seen=new Set();for(const row of rows){const recovery=row.payrollRecovery;if(!recovery)continue;const sourceKey=recovery.staffId+'/'+recovery.sourcePayrollRecordId;if(seen.has(sourceKey))throw Error('Two recoveries refer to the same original payroll. Review them before collecting.');seen.add(sourceKey);if(cents(row.amount)>cents(recovery.overpaymentAmount??recovery.sourceNetPay))throw Error('The recovery exceeds its documented overpayment.');const source=await read(recovery.sourcePayrollRecordId);if(!source)throw Error('The original paid payroll is missing. Review the recovery before payment.');await assertPayrollRecoverySource(recovery,source,crypto);}
}
export function validatePayrollOwnerDeductionSet(data,candidates,get){
 const expected=payrollOwnerDeductionRows(data),due=ownerDeductionCandidates(candidates,data.end);
 if(due.length>OWNER_DEDUCTION_LIMIT||due.length!==expected.length)throw changed();
 const wanted=new Map(expected.map(row=>[row.id,cents(row.amount)]));
 return due.map(row=>{const fresh=get('staff_deductions',row.id),review=get('owner_deduction_reviews',row.id),notice=get('staff_deduction_notices',row.id);if(!fresh)throw changed();const checked=validateOwnerDeductionLink({...fresh,id:row.id},review,notice,{staffId:data.staffId,name:data.name,branch:data.branch,end:data.end});if(!checked||wanted.get(row.id)!==cents(checked.amount)||cents(row.amount)!==cents(checked.amount))throw changed();wanted.delete(row.id);return checked;});
}

// Only the exact due approved links are read. No business record is changed,
// and ordinary payroll without this record type performs no extra link reads.
export async function readPayrollOwnerDeductions(api,sourceRows,end){
 const due=ownerDeductionCandidates(sourceRows,end);if(!due.length)return new Map();
 const identity=actor(api),guard=()=>{if(actor(api)!==identity)throw Error('Your payroll account changed. Regenerate payroll.');};
 const seen=new Set(),counts=new Map();for(const row of due){if(!validId(row.id)||seen.has(row.id))throw changed();seen.add(row.id);const count=(counts.get(row.staffId)||0)+1;counts.set(row.staffId,count);if(count>OWNER_DEDUCTION_LIMIT)throw Error('This employee has too many linked owner-added deductions for one safe payroll.');}
 const references=due.flatMap(row=>[['owner_deduction_reviews',row.id],['staff_deduction_notices',row.id]]),saved=new Map();let next=0,failure;
 await Promise.all(Array.from({length:Math.min(4,references.length)},async()=>{while(!failure&&next<references.length){const [table,id]=references[next++];try{guard();const snap=await api.getDocFromServer(api.doc(api.db,table,id));guard();if(!snap||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||!snap.exists())throw Error('An owner-added deduction review could not be confirmed. Reconnect and regenerate payroll.');saved.set(table+'/'+id,snap.data());}catch(error){failure ||= error;}}}));if(failure)throw failure;guard();
 const checked=due.map(row=>[row.id,validateOwnerDeductionLink(row,saved.get('owner_deduction_reviews/'+row.id),saved.get('staff_deduction_notices/'+row.id),{staffId:row.staffId,name:row.staffName,branch:row.branch,end})]).filter(([,row])=>row);
 await assertPayrollRecoverySources(checked.map(([,row])=>row),async id=>{guard();const snap=await api.getDocFromServer(api.doc(api.db,'payroll_records',id));guard();if(!snap||snap.metadata?.fromCache||snap.metadata?.hasPendingWrites||!snap.exists())throw Error('Reconnect to confirm the original paid payroll before a recovery.');return snap.data();},{crypto:api.crypto});guard();return new Map(checked);
}

export {ownerDeductionCandidates,isOwnerDeduction,OWNER_DEDUCTION_LIMIT};
