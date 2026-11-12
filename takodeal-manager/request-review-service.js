// Ordinary inbox decisions use the saved request and one atomic, stable charge.
// Special attendance, leave, waste and deduction reviews keep their own flows.
import {activeStaffProfile} from './staff-lifecycle-model.js';
const special=new Set(['Schedule Declaration','Leave','Leave Change','Early Time Out','Waste Report']);
const financial=type=>typeof type==='string'&&(type==='Cash Advance'||type==='Staff Meal'||type==='Manager Meal'||/^.+ Meal \(POS Auto\)$/.test(type));
const ownerEmail='jgo031996@gmail.com',quotes=new WeakMap();
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value),staffId=value=>text(value,180)&&value===value.trim()&&!/[\/\\]/.test(value),branch=value=>text(value,128)&&value===value.trim()&&!/^all$/i.test(value),absent=value=>value===undefined||value===null||value==='';
const canonical=value=>JSON.stringify(value,(_key,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))):row);
const fresh=snapshot=>{if(!snapshot||snapshot.metadata?.fromCache!==false||snapshot.metadata?.hasPendingWrites!==false)throw Error('Reconnect to confirm the saved request and staff account.');return snapshot;};
function owner(api){const user=api.auth?.currentUser,session=api.sessionUser;if(!user||typeof user.uid!=='string'||!user.uid||String(user.email||'').trim().toLowerCase()!==ownerEmail||user.emailVerified!==true||!user.providerData?.some(row=>row.providerId==='google.com')||!session||session.uid!==user.uid||session.isFranchisee===true)throw Error('The Owner must review the missing staff account and branch on this older request.');return {user,session,uid:user.uid};}
function person(snapshot,name){if(!snapshot?.exists()||!staffId(snapshot.id))throw Error('The linked staff account is missing. Ask the Owner to review this older request.');const data=snapshot.data();if(!data||data.cashierName!==name||!text(name,200)||!branch(data.branch)||!activeStaffProfile(data)||[data.pin,data.securityPin,data.savedPin].some(value=>/^(REVOKED|BLOCKED)$/i.test(String(value??'').trim()))||!absent(data.staffId)&&data.staffId!==snapshot.id)throw Error('The staff account, saved name or branch is missing, inactive or conflicting. Review the original request before approving it.');return {staffId:snapshot.id,staffName:data.cashierName,branch:data.branch};}
export function ordinaryStaffRequestNeedsRecovery(saved,action){return action==='Approved'&&financial(saved?.type)&&amount(saved.amount,{allowZero:saved.type!=='Cash Advance'})>0&&(!staffId(saved.staffId)||!branch(saved.branch));}
// Exact-name discovery includes archived profiles. Web SDK queries are outside
// the document transaction; this is an explicitly confirmed CURRENT mapping,
// not proof of a historical identity or an atomic uniqueness constraint.
export async function quoteOrdinaryStaffRequestRecovery(api,{id,action,assertCurrent=()=>{}}){
 if(typeof id!=='string'||!id||id.includes('/')||action!=='Approved')throw Error('Reopen this request before reviewing its staff account.');
 const who=owner(api),current=()=>{assertCurrent();const next=owner(api);if(next.user!==who.user||next.session!==who.session||next.uid!==who.uid)throw Error('Your Owner account changed. Reopen this request.');};current();
 const request=fresh(await api.getDocFromServer(api.doc(api.db,'staff_requests',id)));current();if(!request.exists())throw Error('This request no longer exists. Refresh the inbox.');const saved=request.data();if(saved.status===action)return null;if(saved.status!=='Pending')throw Error('This request already has a decision. Refresh the inbox.');if(!ordinaryStaffRequestNeedsRecovery(saved,action))return null;
 requestDate(saved.timestamp);if(!text(saved.staffName,200)||!absent(saved.staffId)&&!staffId(saved.staffId)||!absent(saved.branch)&&!branch(saved.branch))throw Error('The original staff name, account link or branch is invalid. Ask the Owner to review the saved request.');
 let snapshot;if(staffId(saved.staffId)){snapshot=fresh(await api.getDocFromServer(api.doc(api.db,'cashiers',saved.staffId)));current();}
 else {if(typeof api.limit!=='function')throw Error('A complete staff account check is unavailable. Reopen this request.');const matches=fresh(await api.getDocsFromServer(api.query(api.collection(api.db,'cashiers'),api.where('cashierName','==',saved.staffName),api.limit(2))));current();if(matches.docs.length!==1)throw Error('This name matches no saved staff account or more than one account, including archived staff. The Owner must resolve the identity before approval.');snapshot=fresh(matches.docs[0]);}
 const linked=person(snapshot,saved.staffName);if(branch(saved.branch)&&saved.branch!==linked.branch)throw Error('The request branch and current staff branch conflict. Review the original record before approval.');if(!api.isBranchAllowed(linked.branch))throw Error('This branch is outside your access.');
 const quote=Object.freeze({schemaVersion:1,requestId:id,staffId:linked.staffId,staffName:linked.staffName,branch:linked.branch,type:saved.type,amount:amount(saved.amount),missingStaffLink:absent(saved.staffId),missingBranch:absent(saved.branch)});quotes.set(quote,{api,who,createdAt:Date.now(),requestKey:canonical(saved),personKey:canonical(linked)});return quote;
}
function quotedContext(api,quote,id,saved,assertCurrent){const context=quote&&quotes.get(quote);if(!context||context.api!==api||quote.requestId!==id||context.requestKey!==canonical(saved)||Date.now()-context.createdAt>300000||Date.now()<context.createdAt-30000)throw Error('The older request changed or its staff review expired. Reopen and confirm the same request again.');assertCurrent();const who=owner(api);if(who.user!==context.who.user||who.session!==context.who.session||who.uid!==context.who.uid)throw Error('Your Owner account changed. Reopen this request.');return context;}
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
export async function reviewOrdinaryStaffRequest(api,{id,action,reply,proofUrl='',actor,identityQuote=null,assertCurrent=()=>{}}){
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
        let linked=null,recovery=null;
        if(createCharge){if(!text(saved.staffName,200))throw Error('The saved staff name needs Owner review.');if(identityQuote){recovery=quotedContext(api,identityQuote,id,saved,assertCurrent);linked=person(await transaction.get(api.doc(api.db,'cashiers',identityQuote.staffId)),saved.staffName);assertCurrent();if(canonical(linked)!==recovery.personKey||!api.isBranchAllowed(linked.branch))throw Error('The staff account or branch changed after review. Reopen this request.');}else if(ordinaryStaffRequestNeedsRecovery(saved,action))throw Error('This older request needs its staff account and branch confirmed. Reopen it to review the matched record.');}
        assertCurrent();
        if(recovery)quotedContext(api,identityQuote,id,saved,assertCurrent);
        transaction.update(reference,{status:action,managerReply:String(reply||''),proofImageUrl:proofUrl,processedAt:api.serverTimestamp(),processedBy:actor,penaltyCharged:0});
        if(createCharge){
            transaction.set(charge,{staffName:saved.staffName,...(linked?{staffId:linked.staffId}:saved.staffId?{staffId:saved.staffId}:{}),type:saved.type,amount:value,requestId:id,branch:linked?linked.branch:saved.branch,receiptId:saved.receiptId||'',item:saved.item||'',dateAdded:sourceDate,status:'Unpaid',...(recovery?{requestIdentityRecovery:{schemaVersion:1,source:'CurrentStaffProfile',staffId:linked.staffId,staffName:linked.staffName,branch:linked.branch,confirmedByUid:recovery.who.uid,confirmedAt:api.serverTimestamp()}}:{})});
        }
        return {alreadyReviewed:false,charged:createCharge};
    });
}
