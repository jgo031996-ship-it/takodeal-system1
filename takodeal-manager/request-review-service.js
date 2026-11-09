// Ordinary inbox decisions use the saved request and one atomic, stable charge.
// Special attendance, leave, waste and deduction reviews keep their own flows.
const special=new Set(['Schedule Declaration','Leave','Leave Change','Early Time Out','Waste Report']);
const financial=type=>typeof type==='string'&&(type==='Cash Advance'||type==='Staff Meal'||type==='Manager Meal'||/^.+ Meal \(POS Auto\)$/.test(type));
function amount(value,{allowZero=false}={}){
    if(typeof value!=='number'&&typeof value!=='string')throw Error('The saved request amount needs HQ review.');
    if(typeof value==='string'&&!/^\d+(?:\.\d{1,2})?$/.test(value.trim()))throw Error('The saved request amount needs HQ review.');
    const number=typeof value==='number'?value:Number(value);
    if(!Number.isFinite(number)||number<0||number===0&&!allowZero||!Number.isSafeInteger(Math.round(number*100))||Math.abs(number*100-Math.round(number*100))>0.00001)throw Error('The saved request amount needs HQ review.');
    return Math.round(number*100)/100;
}
function requestDate(value){
    let milliseconds;
    if(value instanceof Date)milliseconds=+value;
    else if(value&&typeof value==='object'){
        if(typeof value.toMillis==='function')milliseconds=value.toMillis();
        else if(typeof value.toDate==='function'){const date=value.toDate();if(date instanceof Date)milliseconds=+date;}
    }
    if(!Number.isFinite(milliseconds))throw Error('The saved request date needs HQ review.');
    return value;
}
export async function reviewOrdinaryStaffRequest(api,{id,action,reply,proofUrl='',actor,assertCurrent=()=>{}}){
    if(typeof id!=='string'||!id||id.includes('/')||!['Approved','Rejected'].includes(action))throw Error('Reopen this request before reviewing it.');
    const reference=api.doc(api.db,'staff_requests',id),charge=api.doc(api.db,'staff_deductions','request-'+id);
    return api.runTransaction(api.db,async transaction=>{
        assertCurrent();
        const snapshot=await transaction.get(reference);
        if(!snapshot.exists())throw Error('This request no longer exists. Refresh the inbox.');
        const saved=snapshot.data();
        if(typeof saved.type!=='string'||!saved.type||saved.type.length>200||saved.type!==saved.type.trim())throw Error('The saved request type needs HQ review.');
        if(special.has(saved.type))throw Error('Open the linked specialist review for this request.');
        if(!api.isBranchAllowed(saved.branch))throw Error('This branch is outside your access.');
        if(saved.status===action)return {alreadyReviewed:true,charged:false};
        if(saved.status!=='Pending')throw Error('This request already has a decision. Refresh the inbox before continuing.');
        const financialApproval=action==='Approved'&&financial(saved.type);
        let value,sourceDate,prior;
        if(financialApproval){value=amount(saved.amount,{allowZero:saved.type!=='Cash Advance'});sourceDate=requestDate(saved.timestamp);prior=await transaction.get(charge);if(prior.exists())throw Error('A saved charge already references this request. Review the ledger before changing its decision.');}
        const createCharge=financialApproval&&value>0;
        assertCurrent();
        transaction.update(reference,{status:action,managerReply:String(reply||''),proofImageUrl:proofUrl,processedAt:api.serverTimestamp(),processedBy:actor,penaltyCharged:0});
        if(createCharge){
            transaction.set(charge,{staffName:saved.staffName,...(saved.staffId?{staffId:saved.staffId}:{}),type:saved.type,amount:value,requestId:id,branch:saved.branch,receiptId:saved.receiptId||'',item:saved.item||'',dateAdded:sourceDate,status:'Unpaid'});
        }
        return {alreadyReviewed:false,charged:createCharge};
    });
}
