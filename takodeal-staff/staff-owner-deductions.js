import {isOwnerDeduction,ownerDeductionCandidates,validateOwnerDeductionLink,OWNER_DEDUCTION_TYPE,OWNER_DEDUCTION_LIMIT} from './owner-deduction-model.js';

const fresh=snapshot=>{if(!snapshot||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)throw Error('Reconnect to confirm your one-time deductions.');return snapshot;};
export async function readStaffOwnerDeductionEstimate({rows=[],staffId,name,branch,end,createVault,stillCurrent=()=>true}={}){
 const known=rows.filter(row=>isOwnerDeduction(row)&&row.staffId===staffId),pending=known.some(row=>row.status==='Pending Review');
 const check=()=>{if(!stillCurrent())throw Error('Your Pay session changed. Reopen Pay.');};check();
 if(!known.some(row=>row.status==='Unpaid'))return {total:0,details:[],rows:[],pending,held:false};
 try{
  const vault=await createVault();check();const {sdk,db}=vault,uid=vault.auth?.currentUser?.uid;if(!uid)throw Error('Open Pay on your approved Staff phone to verify these deductions.');
  const guard=()=>{check();if(vault.auth?.currentUser?.uid!==uid)throw Error('Your approved Staff phone session changed.');};
  const snapshot=fresh(await sdk.getDocsFromServer(sdk.query(sdk.collection(db,'staff_deductions'),sdk.where('staffId','==',staffId),sdk.where('type','==',OWNER_DEDUCTION_TYPE),sdk.where('status','==','Unpaid'))));guard();
  if(!Array.isArray(snapshot.docs)||snapshot.docs.length>200)throw Error('Your one-time deductions need HQ review.');
  const current=snapshot.docs.map(doc=>{fresh(doc);return {...doc.data(),id:doc.id};}),due=ownerDeductionCandidates(current,end).filter(row=>row.staffId===staffId);
  if(due.length>OWNER_DEDUCTION_LIMIT)throw Error('HQ must reconcile the linked one-time deductions before confirming this estimate.');
  const result=await Promise.all(due.map(async row=>{const [review,notice]=await Promise.all([sdk.getDocFromServer(sdk.doc(db,'owner_deduction_reviews',row.id)),sdk.getDocFromServer(sdk.doc(db,'staff_deduction_notices',row.id))]);guard();fresh(review);fresh(notice);if(!review.exists()||!notice.exists())throw Error('A linked one-time deduction review is missing.');const checked=validateOwnerDeductionLink(row,review.data(),notice.data(),{staffId,name,branch,end});if(!checked)throw Error('A one-time deduction date changed.');return checked;}));guard();
  return {total:result.reduce((sum,row)=>sum+Math.round(row.amount*100),0)/100,rows:result.map(row=>({id:row.id,amount:row.amount})),details:result.map(row=>({id:row.id,type:OWNER_DEDUCTION_TYPE,bucket:'ownerDeductions',amount:row.amount,label:row.label,category:row.category,incidentDate:row.incidentDate,effectiveDate:row.effectiveDate,reviewRevision:row.revision})),pending,held:false};
 }catch(error){check();return {total:0,details:[],rows:[],pending,held:true,message:error.message||'Reconnect to verify your one-time deductions.'};}
}
