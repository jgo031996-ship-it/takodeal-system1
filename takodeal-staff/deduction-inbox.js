import {isOwnerDeduction} from './owner-deduction-model.js';
import {escapeHtml as esc} from './staff-privacy.js';
const money=value=>'₱'+Number(value||0).toFixed(2);
const readDeadline=promise=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The Inbox connection is slow. Retry when connected.')),20000);})]).finally(()=>clearTimeout(timer));};
export const noticeUnread=row=>Number(row.readRevision||0)<Number(row.noticeRevision||1);
export function validateStaffReply(row,staffId,message){if(row.staffId!==staffId)throw Error('This notice belongs to a different employee.');const reply=String(message||'').trim();if(!reply||reply.length>1500)throw Error('Enter a response of up to 1,500 characters.');return {staffReply:reply,replyRevision:Number(row.replyRevision||0)+1};}
export async function acknowledgeCashShortagePayslip(vault,{recordId,staffId,signature,stillCurrent=()=>true}={}) {
    if (typeof recordId!=='string' || !recordId || recordId.length>500 || recordId.includes('/') || !staffId || !vault?.auth?.currentUser?.uid) throw Error('Reconnect your approved Staff phone before signing this payslip.');
    if (typeof signature!=='string' || signature.length<64 || signature.length>500000 || (signature.length-22)%4!==0 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw Error('Draw your signature again before acknowledging the payslip.');
    const {sdk,db}=vault,uid=vault.auth.currentUser.uid;
    return sdk.runTransaction(db,async tx=>{
        if (!stillCurrent() || vault.auth.currentUser?.uid!==uid) throw Error('Your staff account changed. Reopen your payslip.');
        const ref=sdk.doc(db,'payroll_records',recordId),snap=await tx.get(ref);
        if (!stillCurrent() || vault.auth.currentUser?.uid!==uid) throw Error('Your staff account changed. Reopen your payslip.');
        if (!snap.exists()) throw Error('The saved payslip is unavailable. Reopen Pay while connected.');
        const row=snap.data(),frozen=row.frozenData;
        if (row.staffId!==staffId || [frozen?.staffId,frozen?.profile?.staffId].some(id=>id && id!==staffId)) throw Error('This payslip belongs to a different employee.');
        if (frozen?.isPaid!==true || !(Number(frozen.ownerDeductions)>0 || Array.isArray(frozen.ownerDeductionRows) && frozen.ownerDeductionRows.length>0 || Number(frozen.cashShortages)>0 || Array.isArray(frozen.cashShortageRows) && frozen.cashShortageRows.length>0)) throw Error('Confirm this paid reviewed-deduction payslip with HQ before signing.');
        if (row.acknowledged===true) return {alreadySaved:true};
        tx.update(ref,{acknowledged:true,acknowledgedAt:sdk.serverTimestamp(),signatureBase64:signature});
        return {alreadySaved:false};
    });
}
export async function sendStaffDeductionReply(vault,{noticeId,staffId,message,stillCurrent=()=>true}={}) {
    if (!staffId || !noticeId || !vault?.auth?.currentUser?.uid) throw Error('Reconnect your approved Staff phone before sending a response.');
    const {sdk,db}=vault,uid=vault.auth.currentUser.uid;
    return sdk.runTransaction(db,async tx=>{
        if (!stillCurrent() || vault.auth.currentUser?.uid!==uid) throw Error('Your staff account changed.');
        const ref=sdk.doc(db,'staff_deduction_notices',noticeId),fresh=await tx.get(ref);
        if (!stillCurrent() || vault.auth.currentUser?.uid!==uid) throw Error('Your staff account changed.');
        if (!fresh.exists()) throw Error('The notice is unavailable.');
        const row=fresh.data(),reply=validateStaffReply(row,staffId,message);
        tx.update(ref,{...reply,repliedAt:sdk.serverTimestamp(),repliedByUid:uid});
        return {type:row.type,status:row.status};
    });
}
const cashShortage = row => row.type === 'Cash Shortage';
export function staffDeductionReplyMessage(row) {
    if(isOwnerDeduction(row)&&row.status==='Approved')return 'Response sent. Collection is on hold until the Owner reviews your new response.';
    if(isOwnerDeduction(row)&&row.status==='Paid')return 'Response sent for review. Your saved payslip remains unchanged.';
    if (cashShortage(row) && row.status === 'Approved') return 'Response sent. Collection is on hold until the Owner reviews your new response.';
    if (cashShortage(row) && row.status === 'Paid') return 'Response sent for review. Your saved payslip remains unchanged.';
    return 'Response sent. The Owner can read it in the incident review.';
}
const safeMoney = value => money(Number.isFinite(Number(value)) && Number(value) >= 0 ? value : 0);
export function ownerCustomDeductionNoticeHTML(row,staffId){
 if(!staffId||row.staffId!==staffId||!isOwnerDeduction(row))return '';
 const approved=['Approved','Paid'].includes(row.status),closed=['Dismissed','No Charge'].includes(row.status);
 return '<article class="deduction-notice deduction-shortage"><strong>One-time deduction review · '+esc(row.reasonLabel||row.label||'Owner adjustment')+'</strong><p>'+esc(row.category||'')+(row.incidentDate?' · Incident date: '+esc(row.incidentDate):'')+'</p><p>'+esc(row.details||'')+'</p><p>Evidence / reference: '+esc(row.evidence||'Not recorded')+'</p><p class="deduction-review-state">'+(approved?'Owner-reviewed payroll amount: <strong>'+safeMoney(row.amount)+'</strong> · '+esc(row.status):closed?'Review closed · No payroll deduction.':'Under review · No payroll deduction has been approved.')+'</p>'+(approved?'<dl class="deduction-review-details"><dt>Payroll date</dt><dd>'+esc(row.effectiveDate||'Confirm with Owner')+'</dd><dt>Owner finding</dt><dd>'+esc(row.finding||row.ownerReply||'')+'</dd><dt>Deduction basis</dt><dd>'+esc(row.lawfulBasis||'')+'</dd><dt>Authority / reference</dt><dd>'+esc(row.authorityReference||'')+'</dd></dl>':row.ownerReply?'<p>Owner reply: '+esc(row.ownerReply)+'</p>':'')+'<label>Your response or dispute<textarea data-reply="'+esc(row.id)+'" maxlength="1500" placeholder="Explain what happened or request a correction">'+esc(row.staffReply||'')+'</textarea></label><p class="deduction-response-help">Reading or replying does not authorize a wage deduction. A new response before payment pauses collection until the Owner reviews it again. A reply after payment requests review; your saved payslip stays unchanged.</p><button type="button" data-send-reply="'+esc(row.id)+'">Send response to Owner</button><p data-reply-status="'+esc(row.id)+'" role="status">'+(row.staffReply?'Your response is saved.':'')+'</p></article>';
}
export function deductionNoticeHTML(row, staffId) {
    if(isOwnerDeduction(row))return ownerCustomDeductionNoticeHTML(row,staffId);
    if (!staffId || row.staffId !== staffId) return '';
    const shortage = cashShortage(row), approved = ['Approved','Paid'].includes(row.status);
    const closed = ['Dismissed','No Charge'].includes(row.status);
    const payroll = shortage
        ? `<p class="deduction-review-state">${approved ? `Owner-reviewed payroll amount: <strong>${safeMoney(row.amount)}</strong> · ${esc(row.status)}` : closed ? 'Review closed · No payroll deduction.' : 'Cash shortage under review · No payroll deduction has been approved.'}</p>`
        : `<p>Payroll deduction: <strong>${safeMoney(row.amount)}</strong> · ${esc(row.status)}</p>`;
    const reported = shortage && Number.isFinite(Number(row.sourceShortageCents))
        ? `<p>Reported Z-reading shortage: <strong>${safeMoney(Number(row.sourceShortageCents)/100)}</strong></p>` : '';
    const decision = shortage && approved
        ? `<dl class="deduction-review-details"><dt>Effective date</dt><dd>${esc(row.effectiveDate || 'Confirm with Owner')}</dd><dt>Owner finding</dt><dd>${esc(row.finding || row.ownerReply || '')}</dd><dt>Deduction basis</dt><dd>${esc(row.lawfulBasis || '')}</dd><dt>Authority / reference</dt><dd>${esc(row.authorityReference || '')}</dd></dl><p>Only the approved amount is eligible for an unpaid payroll. Saved paid payslips keep their recorded amounts.</p>`
        : '';
    return `<article class="deduction-notice${shortage ? ' deduction-shortage' : ''}"><strong>${shortage ? 'Cash shortage review · ' : ''}${esc(row.sourcePlatform)} · ${esc(row.sourceReceiptId || row.sourceShiftId)}</strong><p>${esc(row.reasonLabel || (shortage ? 'Z-reading cash variance' : ''))}<br>${esc(row.details)}</p>${reported}${payroll}<p>Evidence / reference: ${esc(row.evidence || '')}</p>${decision}${row.ownerReply && !(shortage && approved) ? `<p>Owner reply: ${esc(row.ownerReply)}</p>` : ''}<label>Your response or dispute<textarea data-reply="${esc(row.id)}" maxlength="1500" placeholder="Explain what happened or ask for a correction">${esc(row.staffReply || '')}</textarea></label>${shortage ? '<p class="deduction-response-help">Opening this notice or sending a response does not authorize a salary deduction. You may explain or dispute the reported shortage here. A new response before payment pauses collection until the Owner reviews it again. Replies after payment request review; your saved payslip remains unchanged.</p>' : ''}<button type="button" data-send-reply="${esc(row.id)}">Send response to Owner</button><p data-reply-status="${esc(row.id)}" role="status">${row.staffReply ? 'Your response is saved.' : ''}</p></article>`;
}
export function deductionFallbackHTML(row, staffId) {
    if(isOwnerDeduction(row))return row.staffId===staffId?'<article class="deduction-notice"><strong>One-time custom deduction review</strong><p>Open your private Inbox to read the record, its amount and status, or send a response. Pending reviews do not reduce pay.</p></article>':'';
    if (!staffId || row.staffId !== staffId) return '';
    if (cashShortage(row)) return `<article class="deduction-notice deduction-shortage"><strong>Cash shortage review</strong><p>Open your private Inbox to see the protected review, any approved amount and to respond. A reported shortage alone is not a payroll deduction.</p></article>`;
    return `<article class="deduction-notice"><strong>${esc(row.type || 'Deduction')}</strong><p>${safeMoney(row.amount)} · ${esc(row.status)}</p><p>${esc(row.remarks || '')}</p></article>`;
}
export function installDeductionInbox(w=window,{d=document,createClient}={}){
    let epoch=0,unsubscribe=null,rows=[],clientPromise=null;const id=()=>w.localStorage.getItem('takodeal_staff_id'),fingerprint=row=>JSON.stringify([row.id,row.status,row.amount,row.noticeRevision||row.reviewRevision||0]);
    const client=()=>clientPromise||(clientPromise=Promise.resolve().then(createClient).catch(e=>{clientPromise=null;throw e;}));
    const seenKey=staffId=>'takodeal_deduction_read_'+staffId;const seen=()=>{try{return JSON.parse(w.localStorage.getItem(seenKey(id())))||[];}catch{return [];}};
    const panel=()=>{let node=d.getElementById('deductionInboxPanel');if(!node){node=d.createElement('section');node.id='deductionInboxPanel';d.getElementById('reqInboxList')?.prepend(node);}return node;};
    function alert(){let button=d.getElementById('staffDeductionAlert');if(!button){button=d.createElement('button');button.type='button';button.id='staffDeductionAlert';button.className='deduction-alert';button.onclick=()=>{w.openReqForm('Inbox');};d.getElementById('staffDocumentReminder')?.before(button);}const old=seen(),unread=rows.filter(row=>!old.includes(fingerprint(row)));if(button){button.hidden=!id()||!unread.length;button.textContent=`${unread.length} payroll review notice${unread.length===1?'':'s'} · Open My Inbox`;}}
    function reset(){epoch++;unsubscribe?.();unsubscribe=null;rows=[];alert();const node=d.getElementById('deductionInboxPanel');if(node)node.replaceChildren();}
    async function start(){reset();const staffId=id(),token=epoch;if(!staffId)return;unsubscribe=w.onSnapshot(w.query(w.collection(w.db,'staff_deductions'),w.where('staffId','==',staffId)),snap=>{if(token!==epoch||id()!==staffId)return;rows=snap.docs.map(doc=>({id:doc.id,...doc.data()}));alert();},()=>{if(token===epoch){const button=d.getElementById('staffDeductionAlert');if(button){button.hidden=false;button.textContent='Deduction notices could not refresh · Open My Inbox to retry';}}});}
    async function load(){const node=panel(),staffId=id(),token=epoch;if(!node||!staffId)return;node.innerHTML='<h3>Deduction notices</h3><p>Loading your messages…</p>';try{const vault=await readDeadline(client());if(token!==epoch||id()!==staffId)return;const sdk=vault.sdk,snap=await readDeadline(sdk.getDocsFromServer(sdk.query(sdk.collection(vault.db,'staff_deduction_notices'),sdk.where('staffId','==',staffId))));if(token!==epoch||id()!==staffId)return;
            const notices=snap.docs.map(doc=>({id:doc.id,...doc.data()})).filter(row=>row.staffId===staffId);node.innerHTML='<h3>Payroll notices &amp; reviews</h3>'+notices.map(row=>deductionNoticeHTML(row,staffId)).join('');
            const onlineIds=new Set(notices.map(r=>r.id));node.insertAdjacentHTML('beforeend',rows.filter(r=>!onlineIds.has(r.id)).map(row=>deductionFallbackHTML(row,staffId)).join(''));
            if(!rows.length&&!notices.length)node.insertAdjacentHTML('beforeend','<p>No deduction notices.</p>');
            node.querySelectorAll('[data-send-reply]').forEach(button=>button.onclick=async()=>{if(token!==epoch||id()!==staffId)return;const noticeId=button.dataset.sendReply,target=[...node.querySelectorAll('[data-reply-status]')].find(e=>e.dataset.replyStatus===noticeId),text=[...node.querySelectorAll('[data-reply]')].find(e=>e.dataset.reply===noticeId)?.value;button.disabled=true;try{const replied=await sendStaffDeductionReply(vault,{noticeId,staffId,message:text,stillCurrent:()=>token===epoch&&id()===staffId});if(token===epoch&&id()===staffId)target.textContent=staffDeductionReplyMessage(replied);}catch(e){if(token===epoch)target.textContent=e.message;}finally{if(button.isConnected)button.disabled=false;}});
            // Reading a notice records acknowledgement, never consent to a charge.
            for(const row of notices)if(noticeUnread(row)){await sdk.runTransaction(vault.db,async tx=>{const ref=sdk.doc(vault.db,'staff_deduction_notices',row.id),fresh=await tx.get(ref);if(token!==epoch||id()!==staffId)return;if(fresh.exists())tx.update(ref,{readRevision:fresh.data().noticeRevision,readAt:sdk.serverTimestamp()});});}
            if(token===epoch&&id()===staffId){w.localStorage.setItem(seenKey(staffId),JSON.stringify(rows.map(fingerprint)));alert();}
        }catch(e){if(token!==epoch||id()!==staffId)return;node.innerHTML='<h3>Deduction notices</h3><p>Your private Inbox needs this phone’s approved Staff access. Open Profile → Required documents to request approval, then retry. Your deduction notice remains unread.</p><button type="button" data-retry-inbox>Retry Inbox</button><button type="button" data-request-inbox>Request phone access</button><p role="status"></p>';node.querySelector('[data-retry-inbox]').onclick=load;node.querySelector('[data-request-inbox]').onclick=async()=>{if(token!==epoch||id()!==staffId)return;try{const vault=await client();if(token!==epoch||id()!==staffId)return;await vault.store.requestDevice({deviceId:w.localStorage.getItem('takodeal_device_id')||'',deviceName:'Staff phone · Inbox access'});if(token===epoch&&id()===staffId)node.querySelector('[role=status]').textContent='Request sent. The Owner can approve this phone in your Master Employee Profile.';}catch(error){if(token===epoch)node.querySelector('[role=status]').textContent=error.message;}};node.querySelector('[role=status]').textContent=e.code==='permission-denied'?'Phone access is not approved yet.':e.message;}}
    const priorStart=w.startInboxListener;w.startInboxListener=function(...args){const result=priorStart?.apply(this,args);start();return result;};
    const priorStop=w.stopStaffLiveListeners;w.stopStaffLiveListeners=function(...args){reset();return priorStop?.apply(this,args);};
    const priorLoad=w.loadInbox;w.loadInbox=async function(...args){const work=load();await priorLoad?.apply(this,args);await work;};
    w.openDeductionInbox=()=>w.openReqForm('Inbox');w.addEventListener('pagehide',reset);w.addEventListener('pageshow',()=>{if(id())start();});if(id())start();return {start,reset,load};
}
