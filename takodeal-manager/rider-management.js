import {reviewRiderStatusAtomic,reviewRiderTopUpAtomic,riderMoneyCents} from './rider-delivery-safety.js';
import {resolveHQAccount} from './hq-account-model.js';
import {canOpenWorkspacePage,createWorkspaceSession,OWNER_EMAIL} from './workspace-access-model.js';
const normalized=value=>String(value || '').trim().toLowerCase();
export function captureRiderManagerActor(api){
    const user=api.auth?.currentUser,session=api.sessionUser,email=normalized(user?.email);
    if(!user?.uid || !email || user.emailVerified!==true || !session || session.uid!==user.uid || normalized(session.email)!==email || !canOpenWorkspacePage(session,'riders'))
        throw Error('Unlock Rider Fleet with your approved Google account before reviewing riders.');
    return {authUid:user.uid,email,session};
}
function assertManagerSession(api,actor){
    const current=captureRiderManagerActor(api);
    if(!actor || current.authUid!==actor.authUid || current.email!==actor.email || current.session!==actor.session)throw Error('Your account changed. Reopen Rider Fleet.');
}
export function configureRiderManagerAuthority(api){
    api.assertRiderManagerAuthority=(actor,rows,branches=[])=>{
        assertManagerSession(api,actor);
        const saved=resolveHQAccount(rows);
        if(saved.blocked===true)throw Error('This Manager account is blocked.');
        const session=createWorkspaceSession({uid:actor.authUid,email:actor.email},saved);
        if(!canOpenWorkspacePage(session,'riders'))throw Error('Your saved permissions do not allow Rider Fleet reviews.');
        if(actor.email!==OWNER_EMAIL){
            const assignment=saved.assignedBranch;
            const allowed=[...new Set((Array.isArray(assignment)?assignment:typeof assignment==='string'?assignment.split(','):[]).map(value=>String(value).trim()).filter(Boolean))];
            if(!allowed.length || branches.some(branch=>branch==='All'?!allowed.includes('All'):!allowed.includes('All') && !allowed.includes(branch)))
                throw Error('This rider fleet is outside your explicitly saved branch permissions.');
        }
        return session;
    };
    api.loadRiderManagerAuthority=async actor=>{
        const current=captureRiderManagerActor(api);if(current.authUid!==actor?.authUid || current.email!==actor?.email || current.session!==actor?.session)throw Error('Your account changed. Reopen Rider Fleet.');
        const snap=await api.getDocsFromServer(api.query(api.collection(api.db,'hq_managers'),api.where('email','==',actor.email)));
        const rows=snap.docs.map(row=>({id:row.id,data:row.data()}));api.assertRiderManagerAuthority(actor,rows,[]);
        return {rows,refs:rows.map(row=>api.doc(api.db,'hq_managers',row.id))};
    };
    return api;
}
export function installRiderManagementSafety(api=window){
    if(api.riderManagementSafety)return api.riderManagementSafety;
    configureRiderManagerAuthority(api);
    let busy=false;const attempts=new Map(),operation=()=>`rider-review-${api.crypto?.randomUUID?.() || globalThis.crypto.randomUUID()}`;
    const attempt=(actor,intent)=>{const key=JSON.stringify([actor.authUid,intent]);if(!attempts.has(key))attempts.set(key,operation());return attempts.get(key);};
    const fresh=async actor=>{const authority=await api.loadRiderManagerAuthority(actor);return authority.rows;};
    const report=error=>api.Swal.fire({title:'Could not save Rider review',text:error.message || 'Reconnect and try the same review again.',icon:'error'});
    const reload=()=>{api.loadRiderManagement?.();api.loadRiderTopUps?.();};
    api.updateRiderStatus=async(riderId,status)=>{
        if(busy)return false;busy=true;
        try{
            const actor=captureRiderManagerActor(api),rows=await fresh(actor),snap=await api.getDocFromServer(api.doc(api.db,'riders',riderId));api.assertRiderManagerAuthority(actor,rows,[]);
            if(!snap.exists())throw Error('This rider no longer exists.');const rider=snap.data();api.assertRiderManagerAuthority(actor,rows,Array.isArray(rider.allowedBranches)&&rider.allowedBranches.length?rider.allowedBranches:['All']);
            const label=status==='active'?'Approve / restore':status==='banned'?'Suspend':status==='rejected'?'Reject':null;if(!label)throw Error('Choose an explicit rider review action.');
            const result=await api.Swal.fire({title:`${label} rider?`,text:`${rider.name || 'This rider'} is currently ${rider.status || 'unreviewed'}. Save this Manager decision?`,icon:'warning',showCancelButton:true,confirmButtonText:label});
            if(!result.isConfirmed)return false;
            const input={riderId,status,expectedStatus:rider.status,actor};input.operationId=attempt(actor,{riderId,status,expectedStatus:rider.status});
            const saved=await reviewRiderStatusAtomic(api,input);assertManagerSession(api,actor);await api.Swal.fire({title:saved.alreadySaved?'Review already saved':'Rider review saved',text:'The saved approval status now controls Rider access.',icon:'success'});assertManagerSession(api,actor);reload();return true;
        }catch(error){await report(error);return false;}finally{busy=false;}
    };
    async function review(requestId,riderId,decision){
        if(busy)return false;busy=true;
        try{
            const actor=captureRiderManagerActor(api),rows=await fresh(actor),requestSnap=await api.getDocFromServer(api.doc(api.db,'rider_topups',requestId));api.assertRiderManagerAuthority(actor,rows,[]);
            if(!requestSnap.exists())throw Error('The top-up request is missing.');const request=requestSnap.data();
            if(request.status!=='pending')throw Error('This top-up has already been reviewed. No additional money was added.');
            if(riderId && riderId!==request.riderId)throw Error('This request belongs to a different rider.');riderId=request.riderId;
            const riderSnap=await api.getDocFromServer(api.doc(api.db,'riders',riderId));api.assertRiderManagerAuthority(actor,rows,[]);
            if(!riderSnap.exists())throw Error('This rider is missing.');const rider=riderSnap.data();api.assertRiderManagerAuthority(actor,rows,Array.isArray(rider.allowedBranches)&&rider.allowedBranches.length?rider.allowedBranches:['All']);
            const options=decision==='approved'?{title:'Credit Rider wallet',text:`Enter the exact amount received for ${rider.name || 'this rider'}. Reference: ${request.reference || 'not recorded'}.`,input:'number',inputAttributes:{min:'0.01',step:'0.01'},showCancelButton:true,confirmButtonText:'Credit wallet',inputValidator:value=>{try{if(riderMoneyCents(value)<=0)return 'Enter a positive amount.';}catch(error){return error.message;}}}:
                {title:'Reject top-up?',text:`Reject the request from ${rider.name || 'this rider'}? The wallet will stay unchanged.`,showCancelButton:true,confirmButtonText:'Reject request',icon:'warning'};
            const result=await api.Swal.fire(options);if(!result.isConfirmed)return false;
            const amount=decision==='approved'?riderMoneyCents(result.value,'top-up amount')/100:0,input={requestId,riderId,decision,amount,actor};input.operationId=attempt(actor,{requestId,riderId,decision,amount});
            const saved=await reviewRiderTopUpAtomic(api,input);assertManagerSession(api,actor);await api.Swal.fire({title:saved.alreadySaved?'Review already saved':'Top-up review saved',text:decision==='approved'?`₱${amount.toFixed(2)} credited once. Current wallet: ₱${saved.walletBalance.toFixed(2)}.`:'The wallet was not credited.',icon:'success'});assertManagerSession(api,actor);reload();return true;
        }catch(error){await report(error);return false;}finally{busy=false;}
    }
    api.approveTopUp=(requestId,riderId)=>review(requestId,riderId,'approved');api.rejectTopUp=requestId=>review(requestId,null,'rejected');
    api.riderManagementSafety={busy:()=>busy};return api.riderManagementSafety;
}
