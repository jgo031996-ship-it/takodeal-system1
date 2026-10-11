// Order incidents are recorded for review. A complaint is never itself a
// payroll authorization; this release deliberately creates zero payable charge.
export const ONLINE_REFUND_TYPE='Online Order Refund';
export const ONLINE_REFUND_LABEL='Online Order Refunds';
export const INCIDENT_REASONS=Object.freeze({wrong_food:'Wrong prepared food',wrong_instructions:'Order instructions not followed',missing_item:'Missing item',other:'Other complaint'});
export const onlinePlatform=sale=>{const method=String(sale?.paymentMethod||'').trim().toLowerCase();return method==='grab'?'Grab':['foodpanda','panda'].includes(method)?'Foodpanda':null;};
const text=(value,label,max=1000)=>{const result=String(value??'').trim();if(!result||result.length>max)throw Error(`${label} is required (up to ${max} characters).`);return result;};
const key=value=>{if(typeof value!=='string'||!value||value.length>180||!/^[-a-zA-Z0-9_]+$/.test(value))throw Error('Use the saved receipt and employee IDs.');return value;};
const cents=(value,label)=>{if(value==null||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<0)throw Error(`${label} must be a non-negative amount.`);return Math.round(Number(value)*100);};
export const activeEmployee=profile=>Boolean(profile&&(profile.cashierName||profile.fullName||profile.name)&&profile.active!==false&&profile.archived!==true&&!/blocked|inactive|terminated|archived|resigned|deleted/i.test(String(profile.status||'')));
export function incidentDraft(input,sale,staff){
    const platform=onlinePlatform(sale);if(!platform||sale.cancelledFoodSourceId||sale.preparedCancellation||['Voided','Parked','mobile_queue'].includes(sale.status))throw Error('Choose a completed Grab or Foodpanda order. Prepared cancellations have their own workflow.');
    if(!sale.receiptId||!sale.branch||!Array.isArray(sale.cart)||!sale.cart.length)throw Error('This receipt needs HQ reconciliation before an incident can be recorded.');
    if(!activeEmployee(staff))throw Error('Choose an active registered employee.');
    if(!Object.hasOwn(INCIDENT_REASONS,input.reason))throw Error('Choose the complaint reason.');
    const total=cents(sale.netTotal,'Saved order total'),refund=cents(input.refundAmount,'Actual refund');
    if(refund>total)throw Error('The actual refund cannot exceed the saved order total.');
    if(typeof input.refundConfirmed!=='boolean'||(!input.refundConfirmed&&refund!==0))throw Error('Unconfirmed complaints must have a zero actual refund.');
    const evidence=text(input.evidence,'Platform reference or evidence',1000),details=text(input.details,'Incident details',1500);
    return {version:1,sourceSaleId:key(input.sourceSaleId),sourceReceiptId:String(sale.receiptId),sourcePlatform:platform,branch:String(sale.branch),
        staffId:key(input.staffId),staffName:String(staff.cashierName||staff.fullName||staff.name),staffBranch:String(staff.branch||sale.branch),
        reason:input.reason,reasonLabel:INCIDENT_REASONS[input.reason],details,evidence,refundConfirmed:input.refundConfirmed,refundAmount:refund/100,orderAmount:total/100,
        status:'Pending Review',amount:0,category:'Online Order Refunds',type:ONLINE_REFUND_TYPE};
}
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
                    if(existing.exists()&&charge.exists()&&Object.keys(data).every(key=>old[key]===data[key])&&ledger.incidentId===id&&ledger.staffId===data.staffId)return {id,alreadyRecorded:true};
                    throw Error('An incident already exists for this order. Open its review; no second charge was created.');
                }
                const createdBy=api.auth.currentUser.email;
                tx.set(ref('online_order_incidents',id),{...data,id,createdAt:api.serverTimestamp(),createdBy,reviewRevision:0});
                tx.set(ref('staff_deductions',id),{type:ONLINE_REFUND_TYPE,category:data.category,status:data.status,amount:0,proposedAmount:data.refundAmount,staffId:data.staffId,staffName:data.staffName,branch:data.staffBranch,sourceBranch:data.branch,sourceSaleId:data.sourceSaleId,sourceReceiptId:data.sourceReceiptId,sourcePlatform:data.sourcePlatform,incidentId:id,remarks:`${data.sourcePlatform} receipt ${data.sourceReceiptId} · ${data.reasonLabel} · Pending review; no salary charge.`,dateAdded:api.serverTimestamp(),loggedBy:createdBy});
                return {id,alreadyRecorded:false};
            });
        },
        async review({id,revision,response,reviewNote,dismiss=false}){guard();key(id);response=text(response,'Recorded staff response',1500);reviewNote=text(reviewNote,'Owner review note',1500);
            return api.runTransaction(api.db,async tx=>{
                const incidentRef=ref('online_order_incidents',id),ledgerRef=ref('staff_deductions',id),snap=await tx.get(incidentRef),ledger=await tx.get(ledgerRef);
                if(!snap.exists()||!ledger.exists())throw Error('The incident review is incomplete. Ask HQ to reconcile the record.');
                const row=snap.data();if(row.reviewRevision!==revision||row.status!=='Pending Review'||ledger.data().status!=='Pending Review'||ledger.data().amount!==0)throw Error('The review changed. Reload it before continuing.');guard();
                const status=dismiss?'Dismissed':'Pending Review';
                tx.update(incidentRef,{status,staffResponse:response,reviewNote,reviewedAt:api.serverTimestamp(),reviewedBy:api.auth.currentUser.email,reviewRevision:revision+1});
                // Private response/evidence stay in the Owner-only case. The
                // legacy deduction feed receives only the review status.
                tx.update(ledgerRef,{status,responseRecorded:true,reviewedAt:api.serverTimestamp(),reviewedBy:api.auth.currentUser.email});
                return {id,status};
            });
        }
    };
}
