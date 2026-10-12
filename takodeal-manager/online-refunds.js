// Only the verified Owner confirms a charge under the reviewed payroll policy.
// Deterministic receipt IDs keep retries and concurrent submissions from charging twice.
export const ONLINE_REFUND_TYPE='Online Order Refund';
export const ONLINE_REFUND_LABEL='Online Order Refunds';
export const INCIDENT_REASONS=Object.freeze({wrong_food:'Wrong prepared food',wrong_instructions:'Order instructions not followed',missing_item:'Missing item',other:'Other complaint'});
export const onlinePlatform=sale=>{const method=String(sale?.paymentMethod||'').trim().toLowerCase();return method==='grab'?'Grab':['foodpanda','panda'].includes(method)?'Foodpanda':null;};
const text=(value,label,max=1000)=>{const result=String(value??'').trim();if(!result||result.length>max)throw Error(`${label} is required (up to ${max} characters).`);return result;};
const key=value=>{if(typeof value!=='string'||!value||value.length>180||!/^[-a-zA-Z0-9_]+$/.test(value))throw Error('Use the saved receipt and employee IDs.');return value;};
const cents=(value,label)=>{if(value==null||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0)throw Error(`${label} must be a non-negative amount.`);return Math.round(Number(value)*100);};
export const activeEmployee=profile=>Boolean(profile&&(profile.cashierName||profile.fullName||profile.name)&&profile.active!==false&&profile.archived!==true&&!/blocked|inactive|terminated|archived|resigned|deleted/i.test(String(profile.status||'')));
export function refundAuthorization(input,refund){if(input.policyReviewed!==true)throw Error('Confirm the reviewed payroll policy and the employee’s opportunity to respond.');if(refund>0&&input.refundConfirmed!==true)throw Error('Confirm the actual platform refund before a deduction.');return text(input.reviewNote,'Owner case review',1500);}
export function incidentDraft(input,sale,staff){
    const platform=onlinePlatform(sale);if(!platform||sale.cancelledFoodSourceId||sale.preparedCancellation||['Voided','Parked','mobile_queue'].includes(sale.status))throw Error('Choose a completed Grab or Foodpanda order. Prepared cancellations have their own workflow.');
    if(!sale.receiptId||!sale.branch||!Array.isArray(sale.cart)||!sale.cart.length)throw Error('This receipt needs HQ reconciliation before an incident can be recorded.');
    if(!activeEmployee(staff))throw Error('Choose an active registered employee.');
    if(!Object.hasOwn(INCIDENT_REASONS,input.reason))throw Error('Choose the complaint reason.');
    const total=cents(sale.netTotal,'Saved order total'),refund=cents(input.refundAmount,'Actual refund');
    if(refund>total)throw Error('The actual refund cannot exceed the saved order total.');
    if(typeof input.refundConfirmed!=='boolean'||(!input.refundConfirmed&&refund!==0))throw Error('Unconfirmed complaints must have a zero actual refund.');
    const evidence=text(input.evidence,'Platform reference or evidence',1000),details=text(input.details,'Incident details',1500);
    const reviewNote=refundAuthorization(input,refund);
    return {version:2,sourceSaleId:key(input.sourceSaleId),sourceReceiptId:String(sale.receiptId),sourcePlatform:platform,branch:String(sale.branch),
        staffId:key(input.staffId),staffName:String(staff.cashierName||staff.fullName||staff.name),staffBranch:String(staff.branch||sale.branch),
        reason:input.reason,reasonLabel:INCIDENT_REASONS[input.reason],details,evidence,refundConfirmed:input.refundConfirmed,refundAmount:refund/100,orderAmount:total/100,
        status:refund>0?'Unpaid':'No Charge',amount:refund/100,authorizedAmount:refund/100,policyReviewed:true,reviewNote,category:'Online Order Refunds',type:ONLINE_REFUND_TYPE};
}
export function refundNotice(row,id){return {version:1,id,incidentId:id,staffId:row.staffId,staffName:row.staffName,type:ONLINE_REFUND_TYPE,sourceReceiptId:row.sourceReceiptId,sourcePlatform:row.sourcePlatform,reasonLabel:row.reasonLabel,details:row.details,evidence:row.evidence,amount:row.amount,status:row.status,noticeRevision:1,readRevision:0,replyRevision:0};}
export function createOnlineRefundEngine(api,{ownerCheck=()=>false}={}){
    const ref=(name,id)=>api.doc(api.db,name,id),guard=()=>{if(!ownerCheck())throw Error('Sign in with the verified Owner account to review order incidents.');};
    return {
        async record(input){guard();const id='online-refund-'+key(input.sourceSaleId);
            return api.runTransaction(api.db,async tx=>{
                const saleSnap=await tx.get(ref('transactions',key(input.sourceSaleId))),staffSnap=await tx.get(ref('cashiers',key(input.staffId))),existing=await tx.get(ref('online_order_incidents',id)),charge=await tx.get(ref('staff_deductions',id));
                if(!saleSnap.exists()||!staffSnap.exists())throw Error('The receipt or employee no longer exists. Reload the report.');
                const data=incidentDraft(input,saleSnap.data(),staffSnap.data());guard();
                if(existing.exists()||charge.exists()){
                    const old=existing.data(),ledger=charge.data();
                    if(existing.exists()&&charge.exists()&&old.recordIntent===JSON.stringify(data)&&ledger.incidentId===id&&ledger.staffId===data.staffId)return {id,alreadyRecorded:true};
                    throw Error('An incident already exists for this order. Open its review; no second charge was created.');
                }
                const createdBy=api.auth.currentUser.email;
                tx.set(ref('online_order_incidents',id),{...data,id,recordIntent:JSON.stringify(data),createdAt:api.serverTimestamp(),createdBy,reviewRevision:0});
                tx.set(ref('staff_deductions',id),{type:ONLINE_REFUND_TYPE,category:data.category,status:data.status,amount:data.amount,authorizedAmount:data.amount,noticeRevision:1,proposedAmount:data.refundAmount,staffId:data.staffId,staffName:data.staffName,branch:data.staffBranch,sourceBranch:data.branch,sourceSaleId:data.sourceSaleId,sourceReceiptId:data.sourceReceiptId,sourcePlatform:data.sourcePlatform,incidentId:id,remarks:`${data.sourcePlatform} receipt ${data.sourceReceiptId} · ${data.reasonLabel}`,dateAdded:api.serverTimestamp(),loggedBy:createdBy});
                tx.set(ref('staff_deduction_notices',id),{...refundNotice(data,id),createdAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()});
                return {id,alreadyRecorded:false};
            });
        },
        async review({id,revision,response,reviewNote,dismiss=false,policyReviewed=false}){guard();key(id);response=text(response,'Recorded staff response',1500);reviewNote=text(reviewNote,'Owner review note',1500);
            return api.runTransaction(api.db,async tx=>{
                const incidentRef=ref('online_order_incidents',id),ledgerRef=ref('staff_deductions',id),noticeRef=ref('staff_deduction_notices',id),snap=await tx.get(incidentRef),ledger=await tx.get(ledgerRef),notice=await tx.get(noticeRef);
                if(!snap.exists()||!ledger.exists())throw Error('The incident review is incomplete. Ask HQ to reconcile the record.');
                const row=snap.data();if(row.reviewRevision!==revision||!['Pending Review','Unpaid'].includes(row.status)||ledger.data().status!==row.status)throw Error('The review changed or the deduction is already paid. Reload it before continuing.');
                const staff=await tx.get(ref('cashiers',row.staffId));if(!dismiss&&(!staff.exists()||!activeEmployee(staff.data())))throw Error('The employee is no longer active.');
                if(!dismiss)refundAuthorization({policyReviewed,refundConfirmed:row.refundConfirmed,reviewNote},row.refundAmount);guard();
                const status=dismiss?'Dismissed':row.refundAmount>0?'Unpaid':'No Charge',amount=dismiss?0:row.refundAmount;
                tx.update(incidentRef,{status,amount,authorizedAmount:amount,policyReviewed:!dismiss,staffResponse:response,reviewNote,reviewedAt:api.serverTimestamp(),reviewedBy:api.auth.currentUser.email,reviewRevision:revision+1});
                tx.update(ledgerRef,{status,amount,authorizedAmount:amount,noticeRevision:notice.exists()?notice.data().noticeRevision+1:1,responseRecorded:true,reviewedAt:api.serverTimestamp(),reviewedBy:api.auth.currentUser.email});
                if(notice.exists())tx.update(noticeRef,{status,amount,ownerReply:reviewNote,noticeRevision:notice.data().noticeRevision+1,updatedAt:api.serverTimestamp()});
                else tx.set(noticeRef,{...refundNotice({...row,status,amount},id),ownerReply:reviewNote,createdAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()});
                return {id,status};
            });
        }
    };
}
