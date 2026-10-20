import {openCashShortageReview,approveCashShortageReview,dismissCashShortageReview} from './cash-shortage.js';
import {OWNER_EMAIL} from './workspace-access-model.js';
import {phDay} from './sanction-schedule.js';
import {cashShortageSource,cashShortageId} from './cash-shortage-model.js';
import {savedShiftCloser,activeShortageStaff,suggestedShiftCloser,shiftCloserSummaryHTML} from './shift-closer-display.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>'₱'+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
export const canReviewCashShortage=w=>w.auth?.currentUser?.email?.toLowerCase()===OWNER_EMAIL&&w.auth.currentUser.emailVerified===true&&w.sessionUser?.isOwner===true&&w.auth.currentUser.uid===w.sessionUser.uid;
export function cashShortageSummaryHTML(shift,cash){return `<div class="cash-shortage-amounts"><div><small>EXPECTED CASH</small><strong>${money(cash.expected)}</strong></div><div><small>DECLARED CASH</small><strong>${money(cash.declared)}</strong></div><div><small>CASH SHORTAGE</small><strong>${money(cash.shortage)}</strong></div></div>${shiftCloserSummaryHTML(shift)}<p><strong>${esc(shift.branch)}</strong> · POS user log: ${esc(shift.cashier||'Not recorded')}</p><p class="cash-shortage-note">The user log can list several people who used the POS. Confirm the saved staff account after checking who handled this cash. A shortage alone does not establish responsibility.</p>`;}
export function installCashShortageUI(w,d,{actions={open:input=>openCashShortageReview(w,input),approve:(id,input)=>approveCashShortageReview(w,id,input),dismiss:(id,input)=>dismissCashShortageReview(w,id,input)},now=()=>new Date()}={}){
 let generation=0,dialog;
 const identity=()=>JSON.stringify([w.auth?.currentUser?.uid,w.auth?.currentUser?.email,w.sessionUser?.uid,w.sessionUser?.isOwner]);
 async function review(shiftId){
  if(!canReviewCashShortage(w))return w.ManagerUI?.notify?.('The signed-in Owner can review cash shortages and authorize payroll deductions.');
  if(dialog?.open)return;
  const token=++generation,key=identity(),node=d.createElement('dialog');dialog=node;node.className='cash-shortage-dialog';node.setAttribute('aria-labelledby','cashShortageTitle');
  node.innerHTML='<header><div><small>Z-READING · CASH ACCOUNTABILITY</small><h2 id="cashShortageTitle">Review cash shortage</h2></div><button type="button" data-close aria-label="Close cash shortage review">×</button></header><div class="cash-shortage-body"><p data-status role="status">Checking the saved Z-reading…</p><div data-content></div></div><footer><button type="button" data-refresh>Refresh review</button><button type="button" data-dismiss hidden>Dismiss without deduction</button><button type="button" data-save hidden>Request staff explanation</button></footer>';
  d.body.append(node);node.showModal();
  const q=selector=>node.querySelector(selector),status=q('[data-status]'),content=q('[data-content]'),save=q('[data-save]'),dismiss=q('[data-dismiss]'),refresh=q('[data-refresh]'),close=q('[data-close]');
  let busy=false,loading=false,row=null,notice=null,timer;
  const current=()=>generation===token&&node.open&&key===identity()&&canReviewCashShortage(w);
  function controls(){for(const button of node.querySelectorAll('button'))button.disabled=busy||loading||!current();close.disabled=busy;if(row?.status==='Pending Review'&&!notice?.staffReply)save.disabled=true;for(const field of content.querySelectorAll('input,select,textarea'))field.disabled=busy||loading||!current();}
  const message=(value,error=false)=>{status.textContent=value;status.setAttribute('role',error?'alert':'status');};
  close.onclick=()=>{if(!busy)node.close();};node.addEventListener('cancel',event=>{if(busy)event.preventDefault();});node.addEventListener('close',()=>{clearTimeout(timer);node.remove();if(dialog===node)dialog=null;});
  async function read(reference){let clock;try{const snap=await Promise.race([w.getDocFromServer(reference),new Promise((_,reject)=>{clock=setTimeout(()=>reject(Error('Reconnect to HQ, then refresh this review.')),25000);})]);if(snap.metadata?.fromCache||snap.metadata?.hasPendingWrites)throw Error('HQ has not confirmed this record yet. Refresh while connected.');return snap;}finally{clearTimeout(clock);}}
  async function load(){
   if(!current()||loading)return;loading=true;controls();message('Checking the saved Z-reading and staff response…');save.hidden=dismiss.hidden=true;
   try{
    const shiftSnap=await read(w.doc(w.db,'shifts',shiftId));if(!current())return;if(!shiftSnap.exists())throw Error('This Z-reading is no longer available.');const shift=shiftSnap.data(),source=cashShortageSource(shiftId,shift),cash={expected:source.expectedCash,declared:source.declaredCash,shortage:source.sourceShortage},caseId=cashShortageId(shiftId);
    const caseSnap=await read(w.doc(w.db,'cash_shortage_reviews',caseId));if(!current())return;row=caseSnap.exists()?caseSnap.data():null;notice=null;
    content.innerHTML=cashShortageSummaryHTML(shift,cash);
    if(!row){
     const closer=savedShiftCloser(shift),[people,closerSnap]=await Promise.all([Promise.race([w.getDocsFromServer(w.query(w.collection(w.db,'cashiers'),w.where('branch','==',shift.branch),w.limit(201))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The staff directory could not refresh. Try again while connected.')),25000);})]),closer.kind==='staff'?read(w.doc(w.db,'cashiers',closer.staffId)):Promise.resolve(null)]);clearTimeout(timer);if(!current())return;
     if(people.metadata?.fromCache||people.metadata?.hasPendingWrites||people.docs.some(s=>s.metadata?.fromCache||s.metadata?.hasPendingWrites)||people.docs.length>200)throw Error('The staff directory needs HQ review before selecting the cashier.');
     const directory=new Map(people.docs.map(s=>[s.id,{...s.data(),id:s.id}]));if(closerSnap?.exists()){const person={...closerSnap.data(),id:closer.staffId};if(person.branch===shift.branch||person.cashierName===closer.name&&activeShortageStaff(person))directory.set(closer.staffId,person);else directory.delete(closer.staffId);}else if(closer.kind==='staff')directory.delete(closer.staffId);
     const staff=[...directory.values()].filter(activeShortageStaff).sort((a,b)=>String(a.cashierName).localeCompare(String(b.cashierName))),suggested=suggestedShiftCloser(shift,staff);
     content.innerHTML+=`<section><h3>1. Identify the cashier for review</h3><label>Staff account<select data-staff required><option value="">Choose the staff member…</option>${staff.map(person=>`<option value="${esc(person.id)}">${esc(person.cashierName)} · ${esc(person.branch)}</option>`).join('')}</select></label><p class="cash-shortage-note" data-closer-selection>${suggested?'The saved closing account is selected for your review. '+(suggested.branch!==shift.branch?'Home branch: '+esc(suggested.branch)+'; closing branch: '+esc(shift.branch)+'. ':'')+'Confirm who handled the cash before requesting an explanation. Selecting this account does not assign responsibility.':closer.kind==='staff'?'The saved closer has no exact active staff account match. Choose the staff account after reviewing the closing records.':'Choose the staff account after reviewing the cash handling records. No staff member is selected from the shared POS user log.'}</p><label>What needs to be explained?<textarea data-details rows="3" maxlength="1500" placeholder="Describe the cash reconciliation and the cashier’s role. Do not assume responsibility from the variance alone." required></textarea></label><label>Evidence or reconciliation reference<input data-evidence maxlength="1500" placeholder="For example, the signed cash count and checked receipt references" required></label><p class="cash-shortage-note">The staff member receives a private notice in the Staff app’s My Inbox. Payroll stays unchanged while the explanation is pending.</p></section>`;
     q('[data-staff]').value=suggested?.id||'';
     save.hidden=false;save.textContent='Request staff explanation';message('No deduction has been created for this Z-reading.');
    }else{
     const noticeSnap=await read(w.doc(w.db,'staff_deduction_notices',caseId));if(!current())return;if(!noticeSnap.exists())throw Error('The linked staff notice is missing. Ask HQ to review the case before proceeding.');notice=noticeSnap.data();
     content.innerHTML+=`<section><h3>${esc(row.staffName)} · ${esc(row.status)}</h3><p>${esc(row.details)}</p><p class="cash-shortage-note">Evidence: ${esc(row.evidence)}</p><h4>Staff response</h4><div class="cash-shortage-response">${esc(notice.staffReply||'Waiting for the staff member’s explanation. Ask them to open My Inbox in the Staff app, then refresh this review.')}</div><p class="cash-shortage-note">A response or acknowledgement is not consent to a wage deduction.</p></section>`;
     if(row.status==='Pending Review'||row.status==='Approved'&&notice.replyRevision!==row.replyRevisionReviewed){
      content.innerHTML+=`<section><h3>2. Review responsibility and deduction authority</h3><p class="cash-shortage-note">Deduct only when responsibility is established after the staff member has had a chance to explain, and a legal authority permits this particular wage deduction. A negative Z-reading or general consent alone is insufficient.</p><div class="cash-shortage-grid"><label>Reviewed deduction (₱)<input data-amount type="number" min="0.01" max="${cash.shortage}" step="0.01" value="${cash.shortage.toFixed(2)}" required></label><label>Effective payroll date (PH)<input data-date type="date" min="${phDay(now())}" value="${phDay(now())}" required></label></div><label>Legal basis<select data-basis required><option value="">Choose the applicable authority…</option><option>Legal authority permitting this deduction</option><option>Court / authorized agency order</option></select></label><label>Authority / order reference and applicability<textarea data-authority rows="2" maxlength="1500" placeholder="Identify the provision or order and why it permits this specific deduction." required></textarea></label><label>Responsibility finding and response review<textarea data-finding rows="3" maxlength="1500" placeholder="Record the evidence, the staff explanation, and why this amount is attributable to this cashier." required></textarea></label><label class="cash-shortage-check"><input type="checkbox" data-responsibility required> I reviewed the staff response and evidence establishing this cashier’s responsibility.</label><label class="cash-shortage-check"><input type="checkbox" data-lawful required> I confirmed that the cited authority permits this deduction and its amount for the selected payroll date.</label></section>`;
      save.hidden=false;save.textContent='Approve payroll deduction';dismiss.hidden=false;message(row.status==='Approved'?'The staff member sent a new response. Payroll collection is on hold until you review it again.':notice.staffReply?'Staff response received. Complete the review before authorizing any deduction.':'Waiting for a staff response. Payroll has no shortage deduction.');
     }else{
      content.innerHTML+=`<section><h3>Payroll record</h3><p>Approved amount: <strong>${money(row.authorizedAmount||row.amount)}</strong>${row.effectiveDate?' · Effective '+esc(row.effectiveDate):''}</p>${row.lawfulBasis?'<p>Authority: '+esc(row.lawfulBasis)+' · '+esc(row.authorityReference)+'</p>':''}${row.finding?'<p>'+esc(row.finding)+'</p>':''}${row.payrollRecordId?'<p>Saved payroll: '+esc(row.payrollRecordId)+'</p>':''}</section>`;
      dismiss.hidden=row.status!=='Approved';message(row.status==='Paid'?'This shortage is already settled in the saved payslip. It cannot be charged again.':row.status==='Approved'?'This approved amount will appear once on an eligible unpaid payslip.':'This review is closed without a payroll deduction.');
     }
     if(['Pending Review','Approved'].includes(row.status))content.innerHTML+='<section><label>Reason for dismissing (only if no deduction should be made)<textarea data-dismiss-reason rows="2" maxlength="1500" placeholder="Explain the reconciliation or why this claim should be closed without a deduction."></textarea></label></section>';
    }
   }catch(error){if(current()){content.replaceChildren();message(error.message||'This review could not be confirmed. Refresh while connected.',true);}}
   finally{clearTimeout(timer);loading=false;if(node.open)controls();}
  }
  async function commit(kind){
   if(busy||loading||!current())return;
   const value=selector=>q(selector)?.value?.trim()||'',checked=selector=>q(selector)?.checked===true;
   let input;
   if(kind==='dismiss'){if(value('[data-dismiss-reason]').length<8)return message('Explain why this shortage should be dismissed, using at least 8 characters.',true);input={reason:value('[data-dismiss-reason]'),expectedRevision:row.revision};}
   else if(!row){if(!value('[data-staff]')||value('[data-details]').length<8||value('[data-evidence]').length<8)return message('Select the staff account and provide the incident details and evidence reference.',true);input={shiftId,staffId:value('[data-staff]'),details:value('[data-details]'),evidence:value('[data-evidence]')};}
   else{
    if(!notice?.staffReply)return message('A staff explanation must be received before approving a deduction.',true);
    if(!checked('[data-responsibility]')||!checked('[data-lawful]')||!value('[data-basis]')||value('[data-authority]').length<8||value('[data-finding]').length<15)return message('Complete the responsibility finding, legal authority and both review confirmations.',true);
    input={amount:Number(value('[data-amount]')),effectiveDate:value('[data-date]'),lawfulBasis:value('[data-basis]'),authorityReference:value('[data-authority]'),finding:value('[data-finding]'),responsibilityConfirmed:true,lawfulAuthorityConfirmed:true,expectedRevision:row.revision,expectedReplyRevision:notice.replyRevision};
   }
   busy=true;controls();message('Saving this review with HQ…');
   try{const id=cashShortageId(shiftId);await (kind==='dismiss'?actions.dismiss(id,input):row?actions.approve(id,input):actions.open(input));if(!current())return;await load();if(current())w.invalidateCollectionCache?.('staff_deductions');}
   catch(error){if(current())message((error.message||'HQ has not confirmed the save.')+' Refresh this same review before retrying.',true);}
   finally{busy=false;if(node.open)controls();}
  }
  save.onclick=()=>commit('save');dismiss.onclick=()=>commit('dismiss');refresh.onclick=()=>load();await load();return node;
 }
 d.addEventListener('click',event=>{const button=event.target.closest?.('[data-cash-shortage]');if(button)void review(button.dataset.cashShortage);});
 return {review};
}
